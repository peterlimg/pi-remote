import SwiftUI

@main
struct PullPreviewApp: App {
    var body: some Scene {
        WindowGroup { PullPreview() }
    }
}

private struct Pull {
    var distance: CGFloat = 0
    var lastTick: CGFloat = 0
    var ticks = 0
    var ready = false
    var upward: Bool?
}

private struct PullPreview: View {
    @State private var pull = Pull()
    @GestureState private var dragging = false
    @State private var showingPicker = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    private var accent: Color {
        colorScheme == .dark ? .primary : Color(red: 0.21, green: 0.40, blue: 0.36)
    }

    var body: some View {
        GeometryReader { geometry in
            let threshold = min(256, max(144, geometry.size.height * 0.4))
            let progress = min(1, pull.distance / threshold)
            VStack(spacing: 0) {
                Text("Pull preview").font(.headline).padding()
                Spacer()
                VStack(spacing: 10) {
                    Text("Pull up for a new session").font(.title3.weight(.semibold))
                    Text("Start at the dots and drag slowly. Pause, then keep pulling to feel the ticks.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(.horizontal, 36)
                .offset(y: reduceMotion ? 0 : -progress * 70)
                Spacer()
                VStack(spacing: 6) {
                    ZStack {
                        Circle().fill(pull.ready ? accent : .clear)
                        Circle().trim(from: 0, to: progress)
                            .stroke(accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Image(systemName: "plus.bubble")
                            .foregroundStyle(pull.ready ? Color(uiColor: .systemBackground) : .secondary)
                    }.frame(width: 32, height: 32)
                    Text(pull.ready ? "Release for new session" : "Pull up for new session").font(.footnote)
                }
                .opacity(pull.distance > 0 ? 1 : 0)
                .offset(y: reduceMotion ? 0 : -progress * 45)
                Image(systemName: "ellipsis").frame(width: 64, height: 44)
                    .opacity(pull.distance > 0 ? 0 : 1)
                    .accessibilityLabel("New session")
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { showingPicker = true }
                Text("Native haptics preview").font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding().background(.thinMaterial, in: Capsule())
                    .padding(.horizontal)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 8)
                .updating($dragging) { _, active, _ in active = true }
                .onChanged { value in
                    let travel = -value.translation.height
                    if pull.upward == nil { pull.upward = travel > abs(value.translation.width) }
                    guard pull.upward == true else { return }
                    pull.distance = max(0, travel)
                    let wasReady = pull.ready
                    pull.ready = travel >= threshold * (wasReady ? 0.9 : 1)
                    pull.lastTick = min(pull.lastTick, pull.distance)
                    if pull.distance - pull.lastTick >= 24 || (pull.ready && !wasReady) {
                        pull.ticks += 1
                        pull.lastTick = pull.distance
                    }
                }
                .onEnded { value in
                    if pull.upward == true && -value.translation.height >= threshold * (pull.ready ? 0.9 : 1) {
                        showingPicker = true
                    }
                })
        }
        .onChange(of: dragging) { _, active in if !active { pull = Pull() } }
        .sensoryFeedback(.selection, trigger: pull.ticks) { old, new in new > old }
        .sheet(isPresented: $showingPicker) {
            VStack(spacing: 16) {
                Text("New session").font(.title2.bold())
                Text("Preview only. No session was created.").foregroundStyle(.secondary)
                Button("Try again") { showingPicker = false }.buttonStyle(.borderedProminent).tint(accent)
                    .foregroundStyle(Color(uiColor: .systemBackground))
            }.presentationDetents([.medium]).presentationDragIndicator(.visible)
        }
    }
}
