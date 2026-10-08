#include <Windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <fcntl.h>
#include <io.h>
#include <wrl.h>

#include <cerrno>
#include <cstdio>
#include <cstdint>
#include <cwchar>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

class ActivationHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
                          IActivateAudioInterfaceCompletionHandler, FtmBase> {
 public:
  void Initialize(HANDLE completed) {
    completed_ = completed;
  }

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

// Usage:
//   --include-window <HWND>        capture the window's process tree only
//   --exclude-process-tree <PID>   capture everything except that tree
// The caller passes its own PID so the app never captures its own voice
// playback or stream players back into a share.
int wmain(int argc, wchar_t** argv) {
  if (argc != 3) return Fail("INVALID_ARGUMENTS");
  unsigned long long raw_value = 0;
  if (!ParseUnsigned(argv[2], &raw_value)) return Fail("INVALID_ARGUMENTS");
  DWORD process_id = 0;
  PROCESS_LOOPBACK_MODE loopback_mode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  if (std::wcscmp(argv[1], L"--exclude-process-tree") == 0) {
    if (raw_value > MAXDWORD) return Fail("INVALID_PROCESS");
    process_id = static_cast<DWORD>(raw_value);
    const HANDLE process =
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
    if (!process) return Fail("PROCESS_NOT_FOUND");
    CloseHandle(process);
    loopback_mode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  } else if (std::wcscmp(argv[1], L"--include-window") == 0) {
    const HWND window =
        reinterpret_cast<HWND>(static_cast<uintptr_t>(raw_value));
    if (!IsWindow(window)) return Fail("WINDOW_CLOSED");
    GetWindowThreadProcessId(window, &process_id);
  } else {
    return Fail("INVALID_ARGUMENTS");
  }
  if (!process_id) return Fail("PROCESS_NOT_FOUND");

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail("COM_INITIALIZATION_FAILED");

  HANDLE completed = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HANDLE samples_ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!completed || !samples_ready) {
    if (completed) CloseHandle(completed);
    if (samples_ready) CloseHandle(samples_ready);
    CoUninitialize();
    return Fail("EVENT_INITIALIZATION_FAILED");
  }

  auto handler = Make<ActivationHandler>();
  if (!handler) {
    CloseHandle(completed);
    CloseHandle(samples_ready);
    CoUninitialize();
    return Fail("ACTIVATION_HANDLER_FAILED");
  }
  handler->Initialize(completed);

  AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = process_id;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode = loopback_mode;

  PROPVARIANT activation{};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(parameters);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                   __uuidof(IAudioClient), &activation,
                                   handler.Get(), &operation);
  if (SUCCEEDED(hr) && WaitForSingleObject(completed, 10000) != WAIT_OBJECT_0)
    hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  if (SUCCEEDED(hr)) hr = handler->result();
  ComPtr<IAudioClient> client = handler->client();
  CloseHandle(completed);
  if (FAILED(hr) || !client) {
    CloseHandle(samples_ready);
    CoUninitialize();
    return Fail("PROCESS_LOOPBACK_UNAVAILABLE");
  }

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign =
      format.nChannels * format.wBitsPerSample / static_cast<WORD>(8);
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format, nullptr);
  if (SUCCEEDED(hr)) hr = client->SetEventHandle(samples_ready);
  ComPtr<IAudioCaptureClient> capture;
  if (SUCCEEDED(hr)) hr = client->GetService(IID_PPV_ARGS(&capture));
  if (SUCCEEDED(hr)) hr = client->Start();
  if (FAILED(hr)) {
    CloseHandle(samples_ready);
    CoUninitialize();
    return Fail("AUDIO_CAPTURE_START_FAILED");
  }

  _setmode(_fileno(stdout), _O_BINARY);
  std::vector<std::uint8_t> silence;
  bool running = true;
  while (running) {
    const DWORD wait_result = WaitForSingleObject(samples_ready, 2000);
    if (wait_result == WAIT_TIMEOUT) continue;
    if (wait_result != WAIT_OBJECT_0) break;
    UINT32 frames = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&frames)) && frames > 0) {
      BYTE* data = nullptr;
      DWORD capture_flags = 0;
      UINT64 position = 0;
      UINT64 timestamp = 0;
      hr = capture->GetBuffer(&data, &frames, &capture_flags, &position,
                              &timestamp);
      if (FAILED(hr)) {
        running = false;
        break;
      }
      const size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
      if (capture_flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        silence.assign(bytes, 0);
        data = silence.data();
      }
      if (std::fwrite(data, 1, bytes, stdout) != bytes ||
          std::fflush(stdout) != 0)
        running = false;
      capture->ReleaseBuffer(frames);
    }
  }

  client->Stop();
  CloseHandle(samples_ready);
  CoUninitialize();
  return running ? 0 : 2;
}
