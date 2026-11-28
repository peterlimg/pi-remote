# Native session pull preview

Open `PullPreview.xcodeproj` in Xcode, select the **PullPreview** scheme and a physical iPhone running iOS 17 or newer. Select your development team under Signing & Capabilities and run. The app works offline; it does not open Pi Remote or create sessions.

Start on the dots. Pull up slowly: feel for a selection tick about every 24 points, then one as the ring fills. Hold still or reverse: ticks should stop. Release early to cancel; release with the ring filled to open the sample sheet. Choose **Try again** to compare a faster pull. The check is what you feel during the drag, not whether the ring moves.

The scheme's UI test checks cancellation and release on a simulator. It cannot check the haptic motor.
