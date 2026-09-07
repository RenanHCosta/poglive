cmake_minimum_required(VERSION 3.24)
project(PogLiveProcessAudio LANGUAGES CXX)

add_executable(poglive-process-audio main.cpp)
target_compile_features(poglive-process-audio PRIVATE cxx_std_20)
target_compile_definitions(poglive-process-audio PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(poglive-process-audio PRIVATE ole32 uuid mmdevapi)
set_target_properties(poglive-process-audio PROPERTIES
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)
