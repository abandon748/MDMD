// Runs only in an opaque sandboxed frame, with synthetic input and no IPC or network.
export async function engineProbe(id: string, token: string) {
  const w = window as any;
  try {
    let isolated = false;
    try {
      void parent.document;
    } catch {
      isolated = true;
    }
    if (!isolated) throw new Error("parent access");
    const box = document.getElementById("probe")!;
    if (id === "highlight") {
      box.innerHTML = w.hljs.highlight("const answer = 42;", {
        language: "javascript",
      }).value;
      if (!box.querySelector(".hljs-keyword")) throw new Error("highlight");
    } else if (id === "katex") {
      box.innerHTML = w.katex.renderToString("x^2 + y^2", {
        trust: false,
        throwOnError: true,
      });
      await document.fonts.ready;
      if (
        !box.querySelector(".katex") ||
        !document.fonts.check("16px KaTeX_Main")
      )
        throw new Error("katex");
    } else if (id === "mermaid") {
      w.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
      });
      const { svg } = await w.mermaid.render(
        "mdmd-probe",
        "flowchart LR\n A --> B",
      );
      box.innerHTML = svg;
      if (!box.querySelector("svg .node")) throw new Error("mermaid");
    } else if (id === "markmap") {
      const { root } = new w.markmap.Transformer().transform("# Root\n## Leaf");
      box.innerHTML = '<svg id="map" style="width:600px;height:400px"></svg>';
      const map = w.markmap.Markmap.create(box.firstElementChild, {
        duration: 0,
      });
      await map.setData(root);
      if (box.querySelectorAll(".markmap-node").length !== 2)
        throw new Error("markmap");
      map.destroy();
    } else throw new Error("id");
    parent.postMessage({ type: "mdmd-engine-probe", token, ok: true }, "*");
  } catch (error) {
    console.error("MDMD engine load", id, String(error));
    parent.postMessage(
      { type: "mdmd-engine-probe", token, error: String(error), ok: false },
      "*",
    );
  }
}
