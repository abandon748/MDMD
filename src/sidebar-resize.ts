// Like the editor split ratio, sidebar width belongs to this window session.
export function setupSidebarResize() {
  const sidebar = document.getElementById("sidebar")!;
  const handle = document.getElementById("sidebar-divider")!;
  const workspace = sidebar.parentElement!;
  let preferred: number | null = null;
  let original: number | null = null;
  let pointer: number | null = null;
  let startX = 0;
  let startWidth = 0;
  let maximum = 480;
  const layout = () => {
    if (!workspace.clientWidth) return;
    const gap = parseFloat(getComputedStyle(workspace).columnGap) || 0;
    maximum = Math.max(160, Math.min(480, workspace.clientWidth - gap - 320));
    const defaultWidth = parseFloat(
      getComputedStyle(sidebar).getPropertyValue("--sidebar-default"),
    );
    const width = Math.round(
      Math.max(160, Math.min(maximum, preferred ?? defaultWidth)),
    );
    sidebar.style.setProperty("--sidebar-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemax", String(Math.floor(maximum)));
  };
  const resize = (width: number) => {
    preferred = Math.max(160, Math.min(maximum, width));
    layout();
  };
  const stop = (cancel: boolean) => {
    if (pointer === null) return;
    if (cancel) {
      preferred = original;
      layout();
    }
    const id = pointer;
    pointer = null;
    document.body.classList.remove("resizing-sidebar");
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0 || pointer !== null) return;
    event.preventDefault();
    original = preferred;
    startX = event.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    pointer = event.pointerId;
    handle.focus();
    handle.setPointerCapture(pointer);
    document.body.classList.add("resizing-sidebar");
  };
  handle.onpointermove = (event) => {
    if (event.pointerId === pointer)
      resize(startWidth + event.clientX - startX);
  };
  handle.onpointerup = () => stop(false);
  handle.onpointercancel = () => stop(true);
  handle.onlostpointercapture = () => stop(false);
  handle.ondblclick = () => {
    preferred = null;
    layout();
  };
  handle.onkeydown = (event) => {
    if (event.key === "Escape") stop(true);
    else if (event.key === "Home") resize(160);
    else if (event.key === "End") resize(maximum);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      resize(
        sidebar.getBoundingClientRect().width +
          (event.key === "ArrowLeft" ? -10 : 10),
      );
    else return;
    event.preventDefault();
  };
  new ResizeObserver(layout).observe(workspace);
  layout();
}
