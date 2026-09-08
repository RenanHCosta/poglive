cmake_minimum_required(VERSION 3.24)
project(PogLiveProcessAudio LANGUAGES CXX)

if(NOT DEFINED POGLIVE_VERSION OR NOT POGLIVE_VERSION MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
  message(FATAL_ERROR "POGLIVE_VERSION must use the form 1.2.3")
endif()

string(REPLACE "." "," POGLIVE_VERSION_COMMA "${POGLIVE_VERSION}")
configure_file(version.rc.in version.rc @ONLY)

add_executable(poglive-process-audio main.cpp "${CMAKE_CURRENT_BINARY_DIR}/version.rc")
target_compile_features(poglive-process-audio PRIVATE cxx_std_20)
target_compile_definitions(poglive-process-audio PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(poglive-process-audio PRIVATE ole32 uuid mmdevapi)
set_target_properties(poglive-process-audio PROPERTIES
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)
