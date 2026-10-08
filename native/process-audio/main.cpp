#include <Windows.h>
#include <TlHelp32.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <mmdeviceapi.h>
#include <fcntl.h>
#include <io.h>
#include <wrl.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <deque>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

// Output: interleaved stereo PCM, 48 kHz, signed 16-bit little endian.
constexpr DWORD kSampleRate = 48000;
constexpr WORD kChannels = 2;
// Mixer: 10 ms ticks, 20 ms of priming per source, at most 100 ms queued.
constexpr size_t kTickSamples = kSampleRate / 100 * kChannels;
constexpr size_t kPrimeSamples = kTickSamples * 2;
constexpr size_t kMaxQueuedSamples = kTickSamples * 10;
constexpr ULONGLONG kRefreshMs = 2000;
constexpr size_t kMaxSources = 48;
constexpr size_t kMaxExcludedRoots = 8;

class ActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
                          IActivateAudioInterfaceCompletionHandler, FtmBase> {
 public:
  void Initialize(HANDLE completed) { completed_ = completed; }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> activated;
    HRESULT activation_result = E_FAIL;
    result_ = operation->GetActivateResult(&activation_result, &activated);
    if (SUCCEEDED(result_)) result_ = activation_result;
    if (SUCCEEDED(result_)) result_ = activated.As(&client_);
    SetEvent(completed_);
    return S_OK;
  }

  HRESULT result() const { return result_; }
  ComPtr<IAudioClient> client() const { return client_; }

 private:
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_PENDING;
  ComPtr<IAudioClient> client_;
};

static int Fail(const char* code) {
  std::fprintf(stderr, "%s\n", code);
  return 1;
}

static bool ParseUnsigned(const wchar_t* text, unsigned long long* value) {
  if (!text || !*text) return false;
  for (const wchar_t* cursor = text; *cursor; ++cursor)
    if (*cursor < L'0' || *cursor > L'9') return false;
  wchar_t* end = nullptr;
  errno = 0;
  *value = std::wcstoull(text, &end, 10);
  return errno == 0 && end && *end == 0 && *value != 0;
}

static WAVEFORMATEX OutputFormat() {
  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  return format;
}

// One process-loopback capture client.
class Capture {
 public:
  ~Capture() {
    if (client_) client_->Stop();
    if (event_) CloseHandle(event_);
  }

  static std::unique_ptr<Capture> Open(DWORD process_id,
                                       PROCESS_LOOPBACK_MODE mode) {
    auto capture = std::unique_ptr<Capture>(new Capture());
    capture->event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HANDLE completed = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!capture->event_ || !completed) {
      if (completed) CloseHandle(completed);
      return nullptr;
    }
    auto handler = Make<ActivationHandler>();
    if (!handler) {
      CloseHandle(completed);
      return nullptr;
    }
    handler->Initialize(completed);
    AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
    parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parameters.ProcessLoopbackParams.TargetProcessId = process_id;
    parameters.ProcessLoopbackParams.ProcessLoopbackMode = mode;
    PROPVARIANT activation{};
    activation.vt = VT_BLOB;
    activation.blob.cbSize = sizeof(parameters);
    activation.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
        &activation, handler.Get(), &operation);
    if (SUCCEEDED(hr) && WaitForSingleObject(completed, 10000) != WAIT_OBJECT_0)
      hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    CloseHandle(completed);
    if (SUCCEEDED(hr)) hr = handler->result();
    capture->client_ = handler->client();
    if (FAILED(hr) || !capture->client_) return nullptr;
    WAVEFORMATEX format = OutputFormat();
    const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                        AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    hr = capture->client_->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0,
                                      &format, nullptr);
    if (SUCCEEDED(hr)) hr = capture->client_->SetEventHandle(capture->event_);
    if (SUCCEEDED(hr))
      hr = capture->client_->GetService(IID_PPV_ARGS(&capture->capture_));
    if (SUCCEEDED(hr)) hr = capture->client_->Start();
    return SUCCEEDED(hr) ? std::move(capture) : nullptr;
  }

  HANDLE event() const { return event_; }

  // Appends every available sample; false when the client stopped working.
  template <typename Sink>
  bool Drain(Sink&& sink) {
    UINT32 frames = 0;
    HRESULT hr;
    while (SUCCEEDED(hr = capture_->GetNextPacketSize(&frames)) && frames > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      if (FAILED(capture_->GetBuffer(&data, &frames, &flags, nullptr, nullptr)))
        return false;
      sink(reinterpret_cast<const int16_t*>(data),
           static_cast<size_t>(frames) * kChannels,
           (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0);
      capture_->ReleaseBuffer(frames);
    }
    return SUCCEEDED(hr);
  }

 private:
  Capture() = default;
  HANDLE event_ = nullptr;
  ComPtr<IAudioClient> client_;
  ComPtr<IAudioCaptureClient> capture_;
};

static bool WriteAll(const void* data, size_t bytes) {
  return std::fwrite(data, 1, bytes, stdout) == bytes &&
         std::fflush(stdout) == 0;
}

// Single tree: the window's process and its children.
static int RunSingle(DWORD process_id) {
  auto capture =
      Capture::Open(process_id, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE);
  if (!capture) return Fail("PROCESS_LOOPBACK_UNAVAILABLE");
  std::vector<int16_t> silence;
  bool running = true;
  while (running) {
    const DWORD wait = WaitForSingleObject(capture->event(), 2000);
    if (wait == WAIT_TIMEOUT) continue;
    if (wait != WAIT_OBJECT_0) break;
    const bool alive = capture->Drain(
        [&](const int16_t* data, size_t samples, bool silent) {
          if (!running) return;
          if (silent) {
            silence.assign(samples, 0);
            data = silence.data();
          }
          running = WriteAll(data, samples * sizeof(int16_t));
        });
    if (!alive) break;
  }
  return running ? 0 : 2;
}

// ───────────────────────── Process table ─────────────────────────

struct ProcessInfo {
  DWORD parent = 0;
  ULONGLONG created = 0;  // 0 when the process could not be opened.
  bool discord = false;
};

static bool IsDiscordExecutable(const wchar_t* name) {
  return _wcsicmp(name, L"Discord.exe") == 0 ||
         _wcsicmp(name, L"DiscordCanary.exe") == 0 ||
         _wcsicmp(name, L"DiscordPTB.exe") == 0 ||
         _wcsicmp(name, L"DiscordDevelopment.exe") == 0;
}

static ULONGLONG CreationTime(DWORD process_id) {
  const HANDLE process =
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (!process) return 0;
  FILETIME created{}, exited{}, kernel{}, user{};
  ULONGLONG value = 0;
  if (GetProcessTimes(process, &created, &exited, &kernel, &user))
    value = (static_cast<ULONGLONG>(created.dwHighDateTime) << 32) |
            created.dwLowDateTime;
  CloseHandle(process);
  return value;
}

class ProcessTable {
 public:
  void Load() {
    processes_.clear();
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) {
      do {
        processes_[entry.th32ProcessID] = {entry.th32ParentProcessID, 0,
                                           IsDiscordExecutable(entry.szExeFile)};
      } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    for (auto& [id, info] : processes_) info.created = CreationTime(id);
  }

  // A recorded parent is trusted only if it existed before the child; this
  // rejects parents whose PID was reused by an unrelated, newer process.
  DWORD Parent(DWORD process_id) const {
    const auto child = processes_.find(process_id);
    if (child == processes_.end() || !child->second.parent) return 0;
    const auto parent = processes_.find(child->second.parent);
    if (parent == processes_.end()) return 0;
    if (child->second.created && parent->second.created &&
        parent->second.created > child->second.created)
      return 0;
    return child->second.parent;
  }

  // True when process_id or one of its ancestors satisfies the predicate.
  template <typename Predicate>
  bool InTree(DWORD process_id, Predicate&& predicate) const {
    DWORD current = process_id;
    for (int depth = 0; current && depth < 64; ++depth) {
      if (predicate(current)) return true;
      current = Parent(current);
    }
    return false;
  }

  bool IsDiscord(DWORD process_id) const {
    const auto found = processes_.find(process_id);
    return found != processes_.end() && found->second.discord;
  }

  std::vector<DWORD> Ids() const {
    std::vector<DWORD> ids;
    ids.reserve(processes_.size());
    for (const auto& entry : processes_) ids.push_back(entry.first);
    return ids;
  }

 private:
  std::unordered_map<DWORD, ProcessInfo> processes_;
};

// Processes owning an audio session on any active output device.
static std::unordered_set<DWORD> SessionProcesses() {
  std::unordered_set<DWORD> result;
  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                              CLSCTX_ALL, IID_PPV_ARGS(&enumerator))))
    return result;
  ComPtr<IMMDeviceCollection> devices;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE,
                                            &devices)))
    return result;
  UINT device_count = 0;
  devices->GetCount(&device_count);
  for (UINT d = 0; d < device_count; ++d) {
    ComPtr<IMMDevice> device;
    ComPtr<IAudioSessionManager2> manager;
    ComPtr<IAudioSessionEnumerator> sessions;
    if (FAILED(devices->Item(d, &device)) ||
        FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL,
                                nullptr, &manager)) ||
        FAILED(manager->GetSessionEnumerator(&sessions)))
      continue;
    int session_count = 0;
    sessions->GetCount(&session_count);
    for (int s = 0; s < session_count; ++s) {
      ComPtr<IAudioSessionControl> control;
      ComPtr<IAudioSessionControl2> control2;
      if (FAILED(sessions->GetSession(s, &control)) ||
          FAILED(control.As(&control2)))
        continue;
      AudioSessionState state{};
      if (control->GetState(&state) == S_OK &&
          state == AudioSessionStateExpired)
        continue;
      if (control2->IsSystemSoundsSession() == S_OK) continue;
      DWORD process_id = 0;
      if (control2->GetProcessId(&process_id) == S_OK && process_id)
        result.insert(process_id);
    }
  }
  return result;
}

// ───────────────────────── Mixer ─────────────────────────

struct Source {
  DWORD process_id = 0;
  std::unique_ptr<Capture> capture;
  std::deque<int16_t> queue;
  bool primed = false;
};

class Mixer {
 public:
  Mixer(std::vector<DWORD> excluded_roots, bool exclude_discord)
      : excluded_roots_(std::move(excluded_roots)),
        exclude_discord_(exclude_discord) {}

  int Run() {
    LARGE_INTEGER frequency{};
    QueryPerformanceFrequency(&frequency);
    const auto now = [&]() {
      LARGE_INTEGER counter{};
      QueryPerformanceCounter(&counter);
      return static_cast<double>(counter.QuadPart) /
             static_cast<double>(frequency.QuadPart);
    };
    std::vector<int32_t> accumulator(kTickSamples);
    std::vector<int16_t> output(kTickSamples);
    ULONGLONG last_refresh = 0;
    double next = now();
    for (;;) {
      if (GetTickCount64() - last_refresh >= kRefreshMs) {
        Refresh();
        last_refresh = GetTickCount64();
      }
      const double wait = (next - now()) * 1000.0;
      const DWORD timeout = wait <= 0 ? 0 : static_cast<DWORD>(std::ceil(wait));
      std::vector<HANDLE> events;
      for (const auto& source : sources_)
        if (events.size() < MAXIMUM_WAIT_OBJECTS)
          events.push_back(source->capture->event());
      if (events.empty())
        Sleep(timeout);
      else
        WaitForMultipleObjects(static_cast<DWORD>(events.size()),
                               events.data(), FALSE, timeout);
      DrainAll();
      const double current = now();
      // After a long stall, restart the clock instead of bursting output.
      if (current - next > 0.2) next = current;
      while (current >= next) {
        std::fill(accumulator.begin(), accumulator.end(), 0);
        for (auto& source : sources_) {
          if (!source->primed) continue;
          const size_t count = std::min(kTickSamples, source->queue.size());
          for (size_t i = 0; i < count; ++i) accumulator[i] += source->queue[i];
          source->queue.erase(source->queue.begin(),
                              source->queue.begin() + count);
          if (source->queue.empty()) source->primed = false;  // Underrun.
        }
        for (size_t i = 0; i < kTickSamples; ++i)
          output[i] = static_cast<int16_t>(
              std::clamp<int32_t>(accumulator[i], INT16_MIN, INT16_MAX));
        if (!WriteAll(output.data(), output.size() * sizeof(int16_t)))
          return 2;  // The app closed the pipe: capture ended.
        next += 0.01;
      }
    }
  }

 private:
  void DrainAll() {
    for (auto& source : sources_) {
      const bool alive = source->capture->Drain(
          [&](const int16_t* data, size_t samples, bool silent) {
            if (silent)
              source->queue.insert(source->queue.end(), samples, 0);
            else
              source->queue.insert(source->queue.end(), data, data + samples);
          });
      if (!alive) source->capture.reset();
      if (source->queue.size() > kMaxQueuedSamples)
        source->queue.erase(
            source->queue.begin(),
            source->queue.begin() + (source->queue.size() - kMaxQueuedSamples));
      if (!source->primed && source->queue.size() >= kPrimeSamples)
        source->primed = true;
    }
    sources_.erase(std::remove_if(sources_.begin(), sources_.end(),
                                  [](const auto& source) {
                                    return !source->capture;
                                  }),
                   sources_.end());
  }

  bool Excluded(const ProcessTable& table, DWORD process_id) const {
    return table.InTree(process_id, [&](DWORD id) {
      return (exclude_discord_ && table.IsDiscord(id)) ||
             std::find(excluded_roots_.begin(), excluded_roots_.end(), id) !=
                 excluded_roots_.end();
    });
  }

  // Captures every process with an audio session, except excluded trees. A
  // process whose own tree contains an excluded process cannot be captured
  // without leaking it (the API only includes whole trees), so it is skipped.
  void Refresh() {
    ProcessTable table;
    table.Load();
    std::vector<DWORD> excluded_all;
    for (DWORD id : table.Ids())
      if (Excluded(table, id)) excluded_all.push_back(id);
    std::unordered_set<DWORD> candidates;
    for (DWORD id : SessionProcesses()) {
      if (Excluded(table, id)) continue;
      const bool contains_excluded =
          std::any_of(excluded_all.begin(), excluded_all.end(), [&](DWORD e) {
            return table.InTree(e, [&](DWORD a) { return a == id; });
          });
      if (!contains_excluded) candidates.insert(id);
    }
    // A candidate already covered by an ancestor's tree would play twice.
    std::unordered_set<DWORD> wanted;
    for (DWORD id : candidates) {
      const DWORD parent = table.Parent(id);
      if (!parent || !table.InTree(parent, [&](DWORD a) {
            return candidates.count(a) > 0;
          }))
        wanted.insert(id);
    }
    sources_.erase(std::remove_if(sources_.begin(), sources_.end(),
                                  [&](const auto& source) {
                                    return wanted.count(source->process_id) == 0;
                                  }),
                   sources_.end());
    for (DWORD id : wanted) {
      if (sources_.size() >= kMaxSources) break;
      const bool open = std::any_of(
          sources_.begin(), sources_.end(),
          [&](const auto& source) { return source->process_id == id; });
      if (open) continue;
      auto capture =
          Capture::Open(id, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE);
      if (!capture) continue;
      auto source = std::make_unique<Source>();
      source->process_id = id;
      source->capture = std::move(capture);
      sources_.push_back(std::move(source));
    }
  }

  std::vector<DWORD> excluded_roots_;
  bool exclude_discord_;
  std::vector<std::unique_ptr<Source>> sources_;
};

static bool ParseProcessList(const wchar_t* text, std::vector<DWORD>* ids) {
  std::wstring value(text ? text : L"");
  if (value.empty() || value.size() > 128) return false;
  size_t start = 0;
  while (start <= value.size()) {
    const size_t comma = value.find(L',', start);
    const std::wstring part =
        value.substr(start, comma == std::wstring::npos ? std::wstring::npos
                                                        : comma - start);
    unsigned long long parsed = 0;
    if (!ParseUnsigned(part.c_str(), &parsed) || parsed > MAXDWORD) return false;
    ids->push_back(static_cast<DWORD>(parsed));
    if (ids->size() > kMaxExcludedRoots) return false;
    if (comma == std::wstring::npos) break;
    start = comma + 1;
  }
  return !ids->empty();
}

// Usage:
//   --include-window <HWND>
//       capture the window's process tree only
//   --system-except <PID>[,<PID>...] [--except-discord]
//       capture every application with an audio session, mixed, except the
//       given process trees and, optionally, every Discord process tree.
// The caller passes its own PID so the app never captures its own voice
// playback or stream players back into a share.
int wmain(int argc, wchar_t** argv) {
  if (argc < 3 || argc > 4) return Fail("INVALID_ARGUMENTS");
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail("COM_INITIALIZATION_FAILED");
  _setmode(_fileno(stdout), _O_BINARY);
  int result = 1;
  if (std::wcscmp(argv[1], L"--include-window") == 0 && argc == 3) {
    unsigned long long raw = 0;
    if (!ParseUnsigned(argv[2], &raw)) {
      result = Fail("INVALID_ARGUMENTS");
    } else {
      const HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(raw));
      DWORD process_id = 0;
      if (!IsWindow(window)) result = Fail("WINDOW_CLOSED");
      else if (!GetWindowThreadProcessId(window, &process_id) || !process_id)
        result = Fail("PROCESS_NOT_FOUND");
      else
        result = RunSingle(process_id);
    }
  } else if (std::wcscmp(argv[1], L"--system-except") == 0) {
    std::vector<DWORD> roots;
    const bool discord =
        argc == 4 && std::wcscmp(argv[3], L"--except-discord") == 0;
    if (!ParseProcessList(argv[2], &roots) || (argc == 4 && !discord))
      result = Fail("INVALID_ARGUMENTS");
    else
      result = Mixer(std::move(roots), discord).Run();
  } else {
    result = Fail("INVALID_ARGUMENTS");
  }
  CoUninitialize();
  return result;
}
