Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'GainRace widget snapshot bridge'
  s.description    = 'Writes the home screen widget snapshot to the App Group and reloads widget timelines.'
  s.author         = 'GainRace'
  s.homepage       = 'https://gainrace.com'
  s.license        = { type: 'UNLICENSED' }
  # Same as the app (Expo SDK 54). WidgetKit itself is iOS 14+.
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
