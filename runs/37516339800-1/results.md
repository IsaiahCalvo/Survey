# iOS simulator run 37516339800-1

- Run: https://github.com/IsaiahCalvo/Survey/actions/runs/37516339800
- PR: #809
- Commit: 1e90e407cd42d18a68b32c6b80381919707fc44f
- Device: iPhone 16 / iOS 26.5 (asked for iPhone 16 / iOS latest)
- Maestro: 2.11.0
- Finished: 2026-10-06 19:29 UTC
- Step outcomes: boot=success devserver=success maestro_install=success ready=success expo_install=success baseline=success flows=success expo=success
- Timings (s from start): start 0, boot-requested 14, devserver 245, booted 347, baseline 495, flows 935, expo 1189, end 1189
- Video: video 70 MB after avconvert (raw 110 MB) is over 8 MB: artifact only

## Flows

### expo-go: exit 0

```

Waiting for flows to complete...
[Passed] expo-go (2m 53s)

1/1 Flow Passed in 2m 53s

```

### smoke: exit 0

```

Waiting for flows to complete...
WARNING: GL pipe is running in software mode (Renderer ID=0x1020400)
[Passed] smoke (4m 40s)

1/1 Flow Passed in 4m 40s

```

## Screenshots

### base-01-safari-home.jpg

![base-01-safari-home.jpg](shots/base-01-safari-home.jpg)

### base-02-safari-document.jpg

![base-02-safari-document.jpg](shots/base-02-safari-document.jpg)

### base-03-expo-go-end.jpg

![base-03-expo-go-end.jpg](shots/base-03-expo-go-end.jpg)

### expo-01-first-screen.jpg

![expo-01-first-screen.jpg](shots/expo-01-first-screen.jpg)

### expo-02-survey-home.jpg

![expo-02-survey-home.jpg](shots/expo-02-survey-home.jpg)

### expo-03-keyboard.jpg

![expo-03-keyboard.jpg](shots/expo-03-keyboard.jpg)

### expo-04-keyboard-typed.jpg

![expo-04-keyboard-typed.jpg](shots/expo-04-keyboard-typed.jpg)

### expo-05-home-guest.jpg

![expo-05-home-guest.jpg](shots/expo-05-home-guest.jpg)

### expo-06-projects-tab.jpg

![expo-06-projects-tab.jpg](shots/expo-06-projects-tab.jpg)

### expo-07-after-scroll.jpg

![expo-07-after-scroll.jpg](shots/expo-07-after-scroll.jpg)

### expo-08-landscape.jpg

![expo-08-landscape.jpg](shots/expo-08-landscape.jpg)

### expo-09-portrait-again.jpg

![expo-09-portrait-again.jpg](shots/expo-09-portrait-again.jpg)

### smoke-01-home.jpg

![smoke-01-home.jpg](shots/smoke-01-home.jpg)

### smoke-02-keyboard.jpg

![smoke-02-keyboard.jpg](shots/smoke-02-keyboard.jpg)

### smoke-03-keyboard-typed.jpg

![smoke-03-keyboard-typed.jpg](shots/smoke-03-keyboard-typed.jpg)

### smoke-04-home-guest.jpg

![smoke-04-home-guest.jpg](shots/smoke-04-home-guest.jpg)

### smoke-05-templates-tab.jpg

![smoke-05-templates-tab.jpg](shots/smoke-05-templates-tab.jpg)

### smoke-06-document.jpg

![smoke-06-document.jpg](shots/smoke-06-document.jpg)

### smoke-07-draw-tool.jpg

![smoke-07-draw-tool.jpg](shots/smoke-07-draw-tool.jpg)

### smoke-08-pages-sheet.jpg

![smoke-08-pages-sheet.jpg](shots/smoke-08-pages-sheet.jpg)

### smoke-09-search-keyboard.jpg

![smoke-09-search-keyboard.jpg](shots/smoke-09-search-keyboard.jpg)

### smoke-10-after-scroll.jpg

![smoke-10-after-scroll.jpg](shots/smoke-10-after-scroll.jpg)

### smoke-11-landscape.jpg

![smoke-11-landscape.jpg](shots/smoke-11-landscape.jpg)

### smoke-12-portrait-again.jpg

![smoke-12-portrait-again.jpg](shots/smoke-12-portrait-again.jpg)

### smoke-step-011-tapOnElement-Continue.jpg

![smoke-step-011-tapOnElement-Continue.jpg](shots/smoke-step-011-tapOnElement-Continue.jpg)

### smoke-step-031-tapOnElement-Search.jpg

![smoke-step-031-tapOnElement-Search.jpg](shots/smoke-step-031-tapOnElement-Search.jpg)

## Step log

```
Xcode 26.6
Build version 17F113
Booting iPhone 16 on iOS 26.5 (6FCA6F73-A772-42AD-9A3C-92AE2F458275)
npm install exit 0
dev server: / -> 200, test pdf -> 200
maestro 2.11.0
booted
Expo Go 57.0.9 installed
shot base-01-safari-home
shot base-02-safari-document
== flow smoke
flow smoke exit 0
== flow expo-go
flow expo-go exit 0
```
