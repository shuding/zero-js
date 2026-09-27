"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { compile, type Diagnostic, type Program } from "@/lib/compiler";
import { EXAMPLES } from "@/lib/examples";
import { SyntaxHighlight } from "./syntax-highlight";
import { supportsCssFunctions } from "@/lib/browser-features";

type FunctionMode = "auto" | "on" | "off";
type EditorState = { source: string; program: Program; error: Diagnostic | null; functionMode: FunctionMode; functionsSupported: boolean | null; recursionSteps: number };
type Edit = { source?: string; functionMode?: FunctionMode; functionsSupported?: boolean; recursionSteps?: number };

function initialState(): EditorState {
  const source = EXAMPLES[0].source;
  const result = compile(source);
  if (!result.ok) throw new Error(result.error.message);
  return { source, program: result.program, error: null, functionMode: "auto", functionsSupported: null, recursionSteps: 64 };
}

function updateSource(state: EditorState, edit: Edit): EditorState {
  const next = { ...state, ...edit };
  const cssFunctions = next.functionMode !== "off" && next.functionsSupported === true;
  const result = compile(next.source, { cssFunctions, recursionSteps: next.recursionSteps });
  return { ...next, program: result.ok ? result.program : state.program, error: result.ok ? null : result.error };
}

export function Playground() {
  const [state, edit] = useReducer(updateSource, undefined, initialState);
  const [example, setExample] = useState<string>(EXAMPLES[0].id);
  const [showSource, setShowSource] = useState(false);
  const [revision, setRevision] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const lines = state.source.split("\n").length;
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const outputKb = (new Blob([state.program.html]).size / 1024).toFixed(1);

  function trackCursor(target: HTMLTextAreaElement) {
    const before = target.value.slice(0, target.selectionStart);
    setCursor({ line: before.split("\n").length, column: before.length - before.lastIndexOf("\n") });
  }

  useEffect(() => { edit({ functionsSupported: supportsCssFunctions() }); }, []);

  function exportHtml() {
    const url = URL.createObjectURL(new Blob([state.program.html], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "zero-js-output.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function goToError() {
    if (!state.error || !editor.current) return;
    editor.current.focus();
    editor.current.setSelectionRange(state.error.offset, state.error.offset);
    editor.current.scrollTop = Math.max(0, (state.error.line - 4) * 25);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1 className="brand">zero-js<span className="brand-cursor" aria-hidden="true" /></h1>
        <p className="tagline">A C-like language that compiles to plain HTML and CSS, so every program runs with zero bytes of JavaScript.</p>
        <span className="js-meter" title="JavaScript in the compiled output"><span className="sr-only">JavaScript in output: </span><span aria-hidden="true">js </span>0 B</span>
      </header>
      <div className="workspace">
        <section className="panel editor-pane" aria-labelledby="source-heading">
          <div className="pane-toolbar editor-toolbar">
            <h2 id="source-heading" className="panel-title">source<span>.zjs</span></h2>
            <label className="example-picker"><span className="picker-label">example</span><select value={example} onChange={event => {
              const selected = EXAMPLES.find(item => item.id === event.target.value);
              if (!selected) return;
              setExample(selected.id);
              edit({ source: selected.source });
              setRevision(value => value + 1);
            }}>
              {example === "custom" ? <option value="custom">Your program</option> : null}
              {EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>

          <div className="code-editor">
            <div className="line-numbers" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, index) => <div className={state.error?.line === index + 1 ? "error-line" : ""} key={index}>{index + 1}</div>)}</div>
            <div className="source-editor">
            <SyntaxHighlight ref={highlight} source={state.source} />
            <textarea ref={editor} className="source-input" aria-label="zero-js source code" aria-describedby="editor-help compile-status" aria-invalid={state.error !== null} value={state.source} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" onChange={event => {
              setExample("custom");
              edit({ source: event.target.value });
            }} onSelect={event => trackCursor(event.currentTarget)} onScroll={event => {
              if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
              if (highlight.current) {
                highlight.current.scrollTop = event.currentTarget.scrollTop;
                highlight.current.scrollLeft = event.currentTarget.scrollLeft;
              }
            }} />
            </div>
          </div>

          <div id="compile-status" className={`compile-status${state.error ? " has-error" : ""}`} role="status" aria-live="polite">
            {state.error ? <button className="error-message" onClick={goToError}><span className="status-dot" /><span><strong>Line {state.error.line}, column {state.error.column}</strong> {state.error.message}</span></button> : <><span className="status-dot" /><span>Compiled successfully</span><span className="status-detail">{state.program.variables} {state.program.variables === 1 ? "variable" : "variables"} · {state.program.outputs} {state.program.outputs === 1 ? "output" : "outputs"}</span></>}
          </div>

          <details className="language-guide">
            <summary id="editor-help">Language reference <span aria-hidden="true">+</span></summary>
            <div className="guide-content">
              <div><code>int a = input("a", 10, 30);</code><p>The optional second and third arguments set the initial value (default 0) and maximum (default 100). A fourth argument sets the minimum (default 0).</p></div>
              <div><code>{'int clicked = click(); int held = press();'}</code><p>Global to the compiled page, with no visible input controls. click toggles between 0 and 1 on each click; press is 1 while holding mouse or focused Space. Click the preview once to focus it. When click is used, releasing Space also toggles it. Repeated calls share the same surface. Page inputs can also be read inline outside functions, as in if (click()) {'{ … }'}.</p></div>
              <div><code>{'float jump = hold_time(.9);'}</code><p>Counts seconds while holding anywhere on the page or using focused Space, up to the duration (default 1 second). Release to reset to zero; hold again to restart. Pause and reduced motion stop the timer.</p></div>
              <div><code>{'float x = arrow_x(280); float y = arrow_y(120);'}</code><p>After clicking the preview, use arrows to change positions from 0 to the maximum (default 100). Positions persist after release. Arrow movement and held Space work together on the same invisible page surface. Requires CSS scroll timelines; Pause and reduced motion affect clocks only.</p></div>
              <div><code>{'int lamp = toggle("lamp"); float x = scroll_x("move", 100);'}</code><p>Named controls remain available for separate switches and pads: toggle, pressed, scroll_x, scroll_y, and hold_time("jump", .9). Sliders and these explicit controls remain clickable above the global surface.</p></div>
              <div><code>{'int w = typed("key", "w");'}</code><p>Returns 1 when the text field contains the specified single printable ASCII character, ignoring letter case. Starts empty; delete to reset. This reads text, so releasing W leaves it set. Labeled controls directly initialize top-level numeric variables or array elements. Assignments recompute from current inputs; they do not retain game state across frames.</p></div>
              <div><code>{'float x = input("x", -0.5, 10, -10);'}</code><p>int stores signed integers and truncates toward zero. float preserves fractions. Numeric storage is bounded to ±1,000,000; floats print to three decimal places.</p></div>
              <div><code>int c = abs(a - b);</code><p>Use +, −, *, /, % (modulo), min, max, clamp, abs, sign, sqrt, hypot, mod, rem, floor, ceil, and round. sin, cos, tan, and atan2 use radians.</p></div>
              <div><code>{"int check = a < b && a != 0;"}</code><p>Compare with &lt;, &gt;, &lt;=, &gt;=, ==, !=. Combine with &amp;&amp;, ||, and !. False is 0; true is 1.</p></div>
              <div><code>{"int c = a > b ? a : b;"}</code><p>Choose a value with condition ? yes : no. Both branches must be valid; only the selected branch prints or draws. Output also respects short-circuit &amp;&amp; and ||.</p></div>
              <div><code>{"if (a > b) { c = a; } else { c = b; }"}</code><p>Reassign declared variables. Blocks have local scope; only the selected branch changes the values that follow.</p></div>
              <div><code>{"int values[3] = {9, 2, 7}; values[i] = 5;"}</code><p>Arrays have 1–32 elements and a literal size. Omitted values are zero or empty strings. Use values[i] to read or write, and print(values) to display every element. Live indices round down; out-of-range reads return zero or an empty string and writes do nothing.</p></div>
              <div><code>{'string greet(string name) { return name; }'}</code><p>Variables, arrays, parameters, and function returns support int, float, and string. Strings select source literals, support reassignment and == / !=, and do not concatenate. Every function path must return a value.</p></div>
              <div><code>{'int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }'}</code><p>Direct tail recursion reuses loop state. Call the same function directly in a return, including a ternary branch. Recursion steps defaults to 64 body executions per call, including the first. Exceeding it shows a runtime error and hides subsequent output. Work after a recursive result and mutual recursion are unsupported.</p></div>
              <div><code>{"for (int i = 0; i < 30; i++) { a = a + i; }"}</code><p>Iterations reuse CSS state and rules through nested HTML. Use literal bounds, &lt; or &lt;=, and i++ or i = i + a positive literal. Maximum 128 iterations per loop; total nesting is bounded.</p></div>
              <div><code>{"if (i >= n) { break; }"}</code><p>break exits the nearest loop; continue skips the rest of its current iteration. Both use CSS state masks, so generated steps remain bounded by the loop's literal limit.</p></div>
              <div><code>{'print(n % 3 == 0 ? "Fizz" : n);'}</code><p>Print numbers, strings, or arrays inside functions, conditionals, and loops. Each call captures its current value; rows follow execution order and skipped calls take no space. Prints respect break, continue, and return. Conditional output can mix numbers and text.</p></div>
              <div><code>{'canvas(320, 240); circle(x, y, 8, click() ? "#0066ff" : "#000");'}</code><p>Draw with rect(x, y, width, height), circle(centerX, centerY, radius), and line(x1, y1, x2, y2), including inside functions, if blocks, and loops. Shapes capture coordinates at each call and respect break, continue, and return. Each accepts an optional color: a hex string, or any string expression that selects one. Coordinates are pixels; canvas dimensions are literals.</p></div>
              <div><code>float t = time(8);</code><p>A CSS clock counts seconds from 0 to 8, then repeats. time() defaults to 60 seconds. Each frame recomputes the program; variables do not persist between frames. Use Pause to stop motion.</p></div>
              <p className="language-note">CSS controls numeric precision. A live zero divisor produces 0; sqrt clamps negative inputs to 0. Keep input and canvas at the top level; input can directly initialize an array element. Functions accept and return scalar values, not whole arrays. Call a function as a statement to discard its return value.</p>
            </div>
          </details>
        </section>

        <section className="panel preview-pane" aria-labelledby="preview-heading">
          <div className="pane-toolbar preview-toolbar">
            <h2 id="preview-heading" className="panel-title">output<span>.html</span></h2>
            <div className="preview-actions"><button className="tui-button" onClick={() => setShowSource(value => !value)} aria-pressed={showSource} title="Inspect the compiled document">view source</button><button className="tui-button" onClick={() => setRevision(value => value + 1)} title="Reset inputs to their initial values">reset</button></div>
          </div>
          <div className="compiler-options">
            <div className="compiler-option">
              <label htmlFor="css-functions">CSS @function</label>
              <select id="css-functions" value={state.functionMode} onChange={event => edit({ functionMode: event.target.value as FunctionMode })}>
                <option value="auto">Auto</option>
                <option value="on" disabled={state.functionsSupported !== true}>On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div className="compiler-option">
              <label htmlFor="recursion-steps">Recursion steps</label>
              <select id="recursion-steps" value={state.recursionSteps} onChange={event => edit({ recursionSteps: Number(event.target.value) })}>
                {[16, 32, 64, 128].map(steps => <option key={steps} value={steps}>{steps}</option>)}
              </select>
            </div>
            <span>{state.functionsSupported === null ? "Checking browser…" : state.functionsSupported ? "Supported" : "Unavailable in this browser"}</span>
          </div>
          {state.error ? <div className="stale-notice">Showing the last valid program.</div> : null}
          <div className="preview-content">
            <iframe key={revision} title="Compiled HTML and CSS program" srcDoc={state.program.html} sandbox="" className="preview-frame" hidden={showSource} />
            {showSource ? <SyntaxHighlight source={state.program.html} variant="generated" /> : null}
          </div>
          <div className="preview-footer"><span>{outputKb} KB html + css</span><button className="tui-button" onClick={exportHtml}>export .html</button></div>
        </section>
      </div>

      <footer className="statusline">
        <span className={`mode${state.error ? " mode-error" : ""}`}>{state.error ? "ERR" : "OK"}</span>
        <span className="status-file">{example === "custom" ? "untitled.zjs" : `${example}.zjs`}</span>
        <span className="status-cursor">Ln {cursor.line}, Col {cursor.column}</span>
        <span className="status-spacer" />
        <span className="status-credit">idea by <a href="https://x.com/shuding" target="_blank" rel="noreferrer">Shu Ding</a></span>
        <a href="https://github.com/shuding/zero-js" target="_blank" rel="noreferrer">github</a>
      </footer>
    </main>
  );
}
