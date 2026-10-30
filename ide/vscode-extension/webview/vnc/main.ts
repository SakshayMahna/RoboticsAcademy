import { $, onMessage, vscode } from "../shared";

const frame = $<HTMLIFrameElement>("vnc");
const placeholder = $("placeholder");
const text = $("placeholder-text");
let url: string | undefined;

function show(next: string | undefined, message: string) {
  url = next;
  if (next) {
    if (frame.src !== next) {
      frame.src = next;
    }
    frame.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    frame.src = "about:blank";
    frame.classList.add("hidden");
    placeholder.classList.remove("hidden");
    text.textContent = message;
  }
}

onMessage<{ type: string; url?: string; message?: string }>((m) => {
  if (m.type === "state") {
    show(m.url, m.message ?? "Waiting for tools…");
  } else if (m.type === "reload" && url) {
    frame.src = "about:blank";
    setTimeout(() => (frame.src = url!), 50);
  }
});

$("reload").addEventListener("click", () => vscode.postMessage({ type: "reload" }));
vscode.postMessage({ type: "ready" });
