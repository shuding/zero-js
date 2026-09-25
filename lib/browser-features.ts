// Test execution, not just parsing: unknown custom functions can pass a syntax
// check while still becoming invalid at computed-value time.
export function supportsCssFunctions(): boolean {
  if (typeof document === "undefined") return false;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;contain:strict;width:0;height:0";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = "@function --css-lang-probe() returns <length> { result: 17px; } span { display:block;width:--css-lang-probe(); }";
  const probe = document.createElement("span");
  shadow.append(style, probe);
  document.body.append(host);
  try { return getComputedStyle(probe).width === "17px"; }
  catch { return false; }
  finally { host.remove(); }
}
