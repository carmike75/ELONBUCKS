(() => {
  const chatWindow = document.getElementById("chat-window");
  const composer = document.getElementById("composer");
  const textInput = document.getElementById("text-input");
  const sendButton = document.getElementById("send-button");
  const micButton = document.getElementById("mic-button");
  const langSelect = document.getElementById("lang-select");
  const voiceOutToggle = document.getElementById("voice-out-toggle");
  const statusRow = document.getElementById("status-row");

  /** @type {{role: "user"|"assistant", content: string}[]} */
  const history = [];

  const GREETINGS = {
    en: "Hello! I'm the J System Assistant. Ask me anything about Giken Kaihatsu's infrared bridge inspection technology — detection performance, the survey process, cost comparisons, or certifications. You can type or use the microphone, in English or Japanese.",
    ja: "こんにちは。Jシステム アシスタントです。技建開発の橋梁赤外線点検技術について、検出性能・調査の流れ・費用比較・認定情報など何でもお尋ねください。テキストまたはマイクで、日本語・英語どちらでもご利用いただけます。",
  };

  function isJapaneseText(text) {
    return /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/.test(text);
  }

  function addMessage(role, content) {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = content;
    chatWindow.appendChild(el);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return el;
  }

  function setStatus(text) {
    if (!text) {
      statusRow.hidden = true;
      statusRow.textContent = "";
      return;
    }
    statusRow.hidden = false;
    statusRow.textContent = text;
  }

  function greet() {
    const pref = langSelect.value;
    const lang = pref === "ja" ? "ja" : pref === "en" ? "en" : navigator.language?.startsWith("ja") ? "ja" : "en";
    addMessage("bot", GREETINGS[lang]);
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    addMessage("user", trimmed);
    history.push({ role: "user", content: trimmed });

    sendButton.disabled = true;
    setStatus(isJapaneseText(trimmed) ? "考え中..." : "Thinking...");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: history.slice(0, -1) }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Request failed");
      }

      const reply = data.reply || "";
      addMessage("bot", reply);
      history.push({ role: "assistant", content: reply });

      if (voiceOutToggle.checked && reply) {
        speak(reply);
      }
    } catch (err) {
      console.error(err);
      addMessage(
        "system",
        "Sorry — something went wrong reaching the assistant. Please try again. / 申し訳ございません、接続エラーが発生しました。もう一度お試しください。"
      );
    } finally {
      sendButton.disabled = false;
      setStatus("");
    }
  }

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    sendMessage(text);
  });

  // ---------- Voice input (Speech-to-Text) ----------
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let recording = false;

  function recognitionLang() {
    const pref = langSelect.value;
    if (pref === "ja") return "ja-JP";
    if (pref === "en") return "en-US";
    return navigator.language?.startsWith("ja") ? "ja-JP" : "en-US";
  }

  if (SpeechRecognitionImpl) {
    recognizer = new SpeechRecognitionImpl();
    recognizer.continuous = false;
    recognizer.interimResults = false;

    recognizer.onstart = () => {
      recording = true;
      micButton.classList.add("recording");
      setStatus(recognizer.lang === "ja-JP" ? "聞いています..." : "Listening...");
    };

    recognizer.onend = () => {
      recording = false;
      micButton.classList.remove("recording");
      setStatus("");
    };

    recognizer.onerror = (event) => {
      recording = false;
      micButton.classList.remove("recording");
      setStatus("");
      if (event.error !== "no-speech" && event.error !== "aborted") {
        addMessage(
          "system",
          "Voice input error — please check microphone permissions. / 音声入力エラー。マイクの権限をご確認ください。"
        );
      }
    };

    recognizer.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      if (transcript) {
        sendMessage(transcript);
      }
    };

    micButton.addEventListener("click", () => {
      if (recording) {
        recognizer.stop();
        return;
      }
      recognizer.lang = recognitionLang();
      try {
        recognizer.start();
      } catch (err) {
        console.error(err);
      }
    });
  } else {
    micButton.disabled = true;
    micButton.title = "Voice input is not supported in this browser. Try Chrome or Edge.";
  }

  // ---------- Voice output (Text-to-Speech) ----------
  let voicesCache = [];
  function loadVoices() {
    voicesCache = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function pickVoice(lang) {
    if (!voicesCache.length) return null;
    const exact = voicesCache.find((v) => v.lang === lang);
    if (exact) return exact;
    const prefix = lang.split("-")[0];
    return voicesCache.find((v) => v.lang.startsWith(prefix)) || null;
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const lang = isJapaneseText(text) ? "ja-JP" : "en-US";
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  greet();
})();
