/* RojLearn frontend logic.
 *
 * Plain vanilla JS, no build step. Talks to the /analyze and /explain API
 * endpoints.
 *
 * Demo mode (canned local results, no backend) is OPT-IN only: it requires
 * COURSELENS_CONFIG.DEMO_MODE === true or a "?demo=1" query parameter. The
 * deployed production site never enables it, so it can never silently fall
 * back to mock data — if the real API fails, the student sees a clear error.
 */
(function () {
  "use strict";

  var CONFIG = window.COURSELENS_CONFIG || {};
  var API_BASE = (CONFIG.API_BASE_URL || "").replace(/\/$/, "");
  var DEMO_REQUESTED =
    CONFIG.DEMO_MODE === true ||
    /[?&]demo=1\b/.test(window.location.search);
  // Demo mode only when explicitly requested. Never inferred from a missing URL.
  var DEMO_MODE = DEMO_REQUESTED;

  // Human-readable labels for document types.
  var TYPE_LABELS = {
    assignment: "an Assignment",
    lecture_notes: "Lecture notes",
    reading: "a Reading",
    syllabus: "a Syllabus",
    rubric: "a Rubric",
    dataset: "a Dataset",
    other: "Other material",
  };

  // Holds the last analyzed input text so "Explain further" has context.
  var lastContextText = "";

  var el = {};

  document.addEventListener("DOMContentLoaded", function () {
    cache();
    wireInput();
    wireNotes();
    if (DEMO_MODE) {
      setStatus(
        "Demo mode: showing sample results locally (no live analysis).",
        ""
      );
    } else if (!API_BASE) {
      // Production must have a real API. If it's missing, fail loud — never
      // silently serve mock data.
      setStatus(
        "Configuration error: the RojLearn API is not configured. Please try again later.",
        "error"
      );
      if (el["analyze-btn"]) el["analyze-btn"].disabled = true;
    }
  });

  function cache() {
    [
      "tab-paste", "tab-file", "panel-paste", "panel-file",
      "paste-input", "file-input", "drop-zone", "drop-label",
      "override-type", "analyze-btn", "input-status",
      "classification-card", "doc-type-label", "doc-confidence",
      "reclassify", "reclassify-btn", "truncation-note", "results",
      "notes-area", "notes-copy", "notes-md", "notes-txt", "notes-clear",
      "notes-saved",
    ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  /* ------------------------------------------------------------------ input */

  var currentFile = null;

  function wireInput() {
    el["tab-paste"].addEventListener("click", function () { switchMode("paste"); });
    el["tab-file"].addEventListener("click", function () { switchMode("file"); });

    el["file-input"].addEventListener("change", function (e) {
      currentFile = e.target.files[0] || null;
      el["drop-label"].textContent = currentFile ? currentFile.name : "Drop a file here or click to choose";
    });

    var dz = el["drop-zone"];
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("dragover"); });
    });
    dz.addEventListener("drop", function (e) {
      currentFile = (e.dataTransfer.files || [])[0] || null;
      el["drop-label"].textContent = currentFile ? currentFile.name : "Drop a file here or click to choose";
    });

    el["analyze-btn"].addEventListener("click", function () {
      analyze(el["override-type"].value || null);
    });
    el["reclassify-btn"].addEventListener("click", function () {
      analyze(el["reclassify"].value || null);
    });
  }

  function switchMode(mode) {
    var paste = mode === "paste";
    el["tab-paste"].classList.toggle("active", paste);
    el["tab-file"].classList.toggle("active", !paste);
    el["tab-paste"].setAttribute("aria-selected", String(paste));
    el["tab-file"].setAttribute("aria-selected", String(!paste));
    el["panel-paste"].classList.toggle("hidden", !paste);
    el["panel-file"].classList.toggle("hidden", paste);
  }

  function setStatus(msg, kind) {
    el["input-status"].textContent = msg || "";
    el["input-status"].className = "status" + (kind ? " " + kind : "");
  }

  /* --------------------------------------------------------------- analyze */

  function analyze(overrideType) {
    var isPaste = !el["panel-paste"].classList.contains("hidden");

    if (isPaste) {
      var text = el["paste-input"].value.trim();
      if (!text) { setStatus("Please paste some text first.", "error"); return; }
      lastContextText = text;
      run(function () {
        return callAnalyze({ inputType: "text", text: text, overrideType: overrideType });
      });
    } else {
      if (!currentFile) { setStatus("Please choose a file first.", "error"); return; }
      readFileAsBase64(currentFile).then(function (b64) {
        lastContextText = "";
        run(function () {
          return callAnalyze({
            inputType: "file",
            fileName: currentFile.name,
            fileContentBase64: b64,
            overrideType: overrideType,
          });
        });
      });
    }
  }

  function run(fn) {
    el["analyze-btn"].disabled = true;
    setStatus("Analyzing with RojLearn...", "working");
    fn()
      .then(function (result) {
        setStatus("", "");
        renderClassification(result);
        renderResult(result);
      })
      .catch(function (err) {
        setStatus(err.message || "Something went wrong.", "error");
      })
      .then(function () { el["analyze-btn"].disabled = false; });
  }

  function callAnalyze(payload) {
    if (DEMO_MODE) return Promise.resolve(demoAnalyze(payload));
    return postJson("/analyze", payload);
  }

  function callExplain(context, target) {
    if (DEMO_MODE) return Promise.resolve(demoExplain(target));
    return postJson("/explain", { context: context, target: target });
  }

  function postJson(path, payload) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var m = (data && data.error && data.error.message) || ("Request failed (" + res.status + ")");
          throw new Error(m);
        }
        return data;
      });
    });
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        // strip the data: URL prefix
        var s = String(reader.result);
        resolve(s.slice(s.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(new Error("Could not read file.")); };
      reader.readAsDataURL(file);
    });
  }

  /* --------------------------------------------------------- render output */

  function renderClassification(result) {
    var t = result.documentType || "other";
    el["classification-card"].classList.remove("hidden");
    el["doc-type-label"].textContent = TYPE_LABELS[t] || t;
    var conf = result.usage ? "" : "";
    el["doc-confidence"].textContent = conf;
    el["reclassify"].value = t;

    var trunc = result.input && result.input.truncated;
    el["truncation-note"].classList.toggle("hidden", !trunc);
    if (trunc) {
      el["truncation-note"].textContent =
        "Note: your input was long and was trimmed to " +
        result.input.originalChars + "+ characters before analysis.";
    }
  }

  function renderResult(result) {
    var root = el["results"];
    root.innerHTML = "";
    if (result.documentType === "assignment") {
      renderAssignment(root, result);
    } else {
      renderLecture(root, result);
    }
  }

  function renderAssignment(root, r) {
    var card = section("3 · Explain & 4 · Plan");

    card.appendChild(block("Explanation", function (b) {
      b.appendChild(para(r.explanation));
      b.appendChild(addBtn("Add to Notes", "Explanation:\n" + r.explanation));
    }));

    listBlock(card, "Requirements", r.requirements);
    listBlock(card, "Deliverables", r.deliverables);
    listBlock(card, "Deadlines", r.deadlines);
    listBlock(card, "Constraints", r.constraints);

    if (r.actionPlan && r.actionPlan.length) {
      card.appendChild(block("Action plan", function (b) {
        r.actionPlan.forEach(function (step) {
          var item = document.createElement("div");
          item.className = "item";
          var head = document.createElement("div");
          head.className = "item-head";
          var title = document.createElement("span");
          title.className = "item-title";
          title.textContent = "Step " + step.step + ": " + step.title;
          head.appendChild(title);
          item.appendChild(head);
          if (step.detail) {
            var body = document.createElement("div");
            body.className = "item-body";
            body.textContent = step.detail;
            item.appendChild(body);
          }
          var actions = document.createElement("div");
          actions.className = "pill-actions";
          actions.appendChild(addBtn(
            "Add to Notes",
            "Step " + step.step + ": " + step.title + "\n" + (step.detail || "")
          ));
          actions.appendChild(explainBtn(step.title, item));
          item.appendChild(actions);
          b.appendChild(item);
        });
      }));
    }

    if (r.concepts && r.concepts.length) {
      card.appendChild(block("Concepts to understand", function (b) {
        r.concepts.forEach(function (c) {
          b.appendChild(conceptItem(c.name, c.whyItMatters));
        });
      }));
    }

    root.appendChild(card);
  }

  function renderLecture(root, r) {
    var card = section("3 · Explain & 5 · Study");

    if (r.summary) {
      card.appendChild(block("Summary", function (b) {
        b.appendChild(para(r.summary));
        b.appendChild(addBtn("Add to Notes", "Summary:\n" + r.summary));
      }));
    }

    if (r.keyConcepts && r.keyConcepts.length) {
      card.appendChild(block("Key concepts", function (b) {
        r.keyConcepts.forEach(function (c) { b.appendChild(conceptItem(c.name, c.explanation)); });
      }));
    }
    if (r.difficultConcepts && r.difficultConcepts.length) {
      card.appendChild(block("Difficult concepts explained", function (b) {
        r.difficultConcepts.forEach(function (c) { b.appendChild(conceptItem(c.name, c.explanation)); });
      }));
    }

    if (r.quiz && r.quiz.length) {
      card.appendChild(block("Study quiz", function (b) {
        r.quiz.forEach(function (q, i) {
          var item = document.createElement("div");
          item.className = "item";
          var title = document.createElement("div");
          title.className = "item-title";
          title.textContent = "Q" + (i + 1) + ". " + q.question;
          item.appendChild(title);
          var ans = document.createElement("details");
          var sum = document.createElement("summary");
          sum.textContent = "Show answer";
          ans.appendChild(sum);
          var ap = document.createElement("div");
          ap.className = "item-body";
          ap.textContent = q.answer;
          ans.appendChild(ap);
          item.appendChild(ans);
          var actions = document.createElement("div");
          actions.className = "pill-actions";
          actions.appendChild(addBtn("Add to Notes", "Q: " + q.question + "\nA: " + q.answer));
          item.appendChild(actions);
          b.appendChild(item);
        });
      }));
    }

    root.appendChild(card);
  }

  /* --------------------------------------------------------- render helpers */

  function section(heading) {
    var card = document.createElement("section");
    card.className = "card result-section-wrap";
    var h = document.createElement("h2");
    h.textContent = heading;
    card.appendChild(h);
    return card;
  }

  function block(heading, fill) {
    var wrap = document.createElement("div");
    wrap.className = "result-section";
    var h = document.createElement("h3");
    h.textContent = heading;
    wrap.appendChild(h);
    fill(wrap);
    return wrap;
  }

  function para(text) {
    var p = document.createElement("p");
    p.textContent = text || "";
    return p;
  }

  function listBlock(card, heading, items) {
    if (!items || !items.length) return;
    card.appendChild(block(heading, function (b) {
      var ul = document.createElement("ul");
      items.forEach(function (it) {
        var li = document.createElement("li");
        li.textContent = it;
        ul.appendChild(li);
      });
      b.appendChild(ul);
      b.appendChild(addBtn("Add to Notes", heading + ":\n- " + items.join("\n- ")));
    }));
  }

  function conceptItem(name, body) {
    var item = document.createElement("div");
    item.className = "item";
    var head = document.createElement("div");
    head.className = "item-head";
    var title = document.createElement("span");
    title.className = "item-title";
    title.textContent = name;
    head.appendChild(title);
    item.appendChild(head);
    if (body) {
      var b = document.createElement("div");
      b.className = "item-body";
      b.textContent = body;
      item.appendChild(b);
    }
    var actions = document.createElement("div");
    actions.className = "pill-actions";
    actions.appendChild(addBtn("Add to Notes", name + ": " + (body || "")));
    actions.appendChild(explainBtn(name, item));
    item.appendChild(actions);
    return item;
  }

  function addBtn(label, text) {
    var b = document.createElement("button");
    b.className = "secondary mini";
    b.textContent = label;
    b.addEventListener("click", function () {
      appendToNotes(text);
      b.textContent = "Added ✓";
      setTimeout(function () { b.textContent = label; }, 1200);
    });
    return b;
  }

  function explainBtn(target, container) {
    var b = document.createElement("button");
    b.className = "secondary mini";
    b.textContent = "Explain further";
    b.addEventListener("click", function () {
      b.disabled = true;
      b.textContent = "Explaining...";
      callExplain(lastContextText || target, target)
        .then(function (res) {
          var out = document.createElement("div");
          out.className = "explain-out";
          out.textContent = res.explanation || "";
          var add = addBtn("Add to Notes", "Explanation of " + target + ":\n" + (res.explanation || ""));
          container.appendChild(out);
          container.appendChild(add);
        })
        .catch(function (err) {
          var out = document.createElement("div");
          out.className = "explain-out";
          out.textContent = "Could not explain: " + (err.message || "error");
          container.appendChild(out);
        })
        .then(function () { b.disabled = false; b.textContent = "Explain further"; });
    });
    return b;
  }

  /* ------------------------------------------------------------- My Notes */

  var NOTES_KEY = "courselens.notes.v1";
  var saveTimer = null;

  function wireNotes() {
    // Load persisted notes.
    try {
      var saved = localStorage.getItem(NOTES_KEY);
      if (saved !== null) el["notes-area"].value = saved;
    } catch (e) { /* localStorage may be unavailable; ignore */ }

    el["notes-area"].addEventListener("input", function () {
      scheduleSave();
    });

    el["notes-copy"].addEventListener("click", function () {
      var text = el["notes-area"].value;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { flashSaved("Copied"); });
      } else {
        el["notes-area"].select();
        document.execCommand("copy");
        flashSaved("Copied");
      }
    });

    el["notes-md"].addEventListener("click", function () {
      download("rojlearn-notes.md", "# RojLearn Notes\n\n" + el["notes-area"].value);
    });
    el["notes-txt"].addEventListener("click", function () {
      download("rojlearn-notes.txt", el["notes-area"].value);
    });
    el["notes-clear"].addEventListener("click", function () {
      if (!el["notes-area"].value || confirm("Clear all notes? This cannot be undone.")) {
        el["notes-area"].value = "";
        persistNotes();
        flashSaved("Cleared");
      }
    });
  }

  function appendToNotes(text) {
    var area = el["notes-area"];
    var prefix = area.value && !area.value.endsWith("\n") ? "\n\n" : (area.value ? "\n" : "");
    area.value = area.value + prefix + text + "\n";
    persistNotes();
    flashSaved("Added");
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNotes, 300);
  }

  function persistNotes() {
    try {
      localStorage.setItem(NOTES_KEY, el["notes-area"].value);
      flashSaved("Saved locally");
    } catch (e) {
      el["notes-saved"].textContent = "Could not save (storage unavailable)";
    }
  }

  function flashSaved(msg) {
    var n = el["notes-saved"];
    n.textContent = msg;
    n.classList.add("flash");
    setTimeout(function () { n.classList.remove("flash"); n.textContent = "Saved locally"; }, 1000);
  }

  function download(filename, content) {
    var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------ demo mode */

  function demoAnalyze(payload) {
    var type = payload.overrideType ||
      guessType(payload.text || (payload.fileName || ""));
    if (type === "assignment") {
      return {
        documentType: "assignment",
        explanation:
          "This assignment asks you to write a short research essay analyzing " +
          "the causes of a historical event, using at least three credible sources.",
        requirements: ["1000-1500 words", "At least 3 credible sources", "APA citations"],
        deliverables: ["A written essay submitted as a PDF"],
        deadlines: ["Due Friday at 11:59 PM"],
        constraints: ["No AI-generated text may be submitted as your own", "APA format"],
        actionPlan: [
          { step: 1, title: "Understand the prompt", detail: "Restate the question in your own words and identify the event to analyze." },
          { step: 2, title: "Gather sources", detail: "Find at least three credible sources and take structured notes." },
          { step: 3, title: "Outline the essay", detail: "Draft a thesis and organize your main points before writing." },
          { step: 4, title: "Write and cite", detail: "Write each section, citing sources in APA as you go." },
          { step: 5, title: "Revise", detail: "Check the word count, citations, and clarity before submitting." },
        ],
        concepts: [
          { name: "Thesis statement", whyItMatters: "A clear thesis focuses your whole essay." },
          { name: "APA citation", whyItMatters: "Correct citations are required and prevent plagiarism." },
        ],
        input: { source: payload.inputType === "file" ? "pdf" : "text", truncated: false, originalChars: (payload.text || "").length },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    return {
      documentType: type === "assignment" ? "reading" : type,
      summary:
        "These notes introduce the concept of photosynthesis: how plants convert " +
        "light energy into chemical energy, and the roles of chlorophyll and the " +
        "light-dependent and light-independent reactions.",
      keyConcepts: [
        { name: "Photosynthesis", explanation: "The process plants use to turn light into chemical energy." },
        { name: "Chlorophyll", explanation: "The pigment that absorbs light for photosynthesis." },
      ],
      difficultConcepts: [
        { name: "Calvin cycle", explanation: "The light-independent reactions that build sugar from CO2." },
      ],
      quiz: [
        { question: "What is photosynthesis?", answer: "Converting light energy into chemical energy in plants." },
        { question: "What role does chlorophyll play?", answer: "It absorbs light energy used to drive the reactions." },
        { question: "Name the two main stages.", answer: "Light-dependent reactions and the Calvin cycle." },
        { question: "Where does the Calvin cycle occur?", answer: "In the stroma of the chloroplast." },
        { question: "What gas is released by photosynthesis?", answer: "Oxygen." },
      ],
      input: { source: payload.inputType === "file" ? "pdf" : "text", truncated: false, originalChars: (payload.text || "").length },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  function demoExplain(target) {
    return {
      explanation:
        "Here's a plain-language explanation of \"" + target + "\": break it into " +
        "the core idea, why it matters, and a quick example. (Demo mode — connect " +
        "the API to get a real Bedrock explanation.)",
    };
  }

  function guessType(text) {
    var t = (text || "").toLowerCase();
    if (/assignment|due|submit|deliverable|word count|rubric|essay/.test(t)) return "assignment";
    return "lecture_notes";
  }
})();
