import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, type CompilerOptions } from "./compiler";
import { EXAMPLES } from "./examples";

function valid(source: string, options: CompilerOptions = {}) {
  const result = compile(source, options);
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  return result.program;
}

function decodeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]!);
}

// Evaluate the emitted CSS arithmetic, independently of the parser.
// This checks changing inputs and assignment order without launching a browser.
function evaluateProgram(source: string, inputs: Record<string, number> = {}, options: CompilerOptions = {}, seconds = 0) {
  const html = valid(source, options).html;
  const values = new Map<string, number>();
  const inputWidths = new Map<string, number>();
  const inputScales = new Map<string, number>();
  const math = {
    calc: (value: number) => value,
    clamp: (low: number, value: number, high: number) => Math.max(low, Math.min(value, high)),
    round: (mode: number, value: number, step: number) => (mode === 0 ? Math.floor(value / step) : mode === 1 ? Math.ceil(value / step) : mode === 3 ? Math.trunc(value / step) : Math.floor(value / step + 0.5)) * step,
    down: 0, up: 1, nearest: 2, toZero: 3,
    min: Math.min, max: Math.max, abs: Math.abs, sign: Math.sign,
    sqrt: Math.sqrt, hypot: Math.hypot,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2,
    mod: (a: number, b: number) => a - b * Math.floor(a / b),
    rem: (a: number, b: number) => a % b,
  };
  for (const match of html.matchAll(/#input-(\d+) \{ anchor-name: --[^;]+; width: ([\d.]+)px;/g)) {
    const [, id, width] = match;
    const label = html.match(new RegExp(`<label[^>]+for="input-${id}"[^>]*>([^<]*)</label>`))![1];
    const scale = Number(html.match(new RegExp(`#bridge-${id}, #read-${id} \\{[^}]*--scale: (\\d+)`))![1]);
    const minimum = Number(html.match(new RegExp(`#capture-${id} \\{ --v${id}: clamp\\((-?[\\d.]+)px`))![1]);
    inputScales.set(`v${id}`, scale);
    inputWidths.set(`v${id}`, label in inputs ? (inputs[label] - minimum) * scale + 32 : Number(width));
  }
  for (const [, id, period] of html.matchAll(/@keyframes clock-(\d+) \{[^\n]*to \{ --clock-\d+: ([\d.]+)px/g)) values.set(`clock-${id}`, seconds % Number(period));
  const functions: Record<string, (...args: number[]) => number> = {};
  const evaluate = (expression: string, resolve: (name: string) => number): number => {
    expression = expression.replace(/var\(--([a-z0-9-]+)\)/g, (_, name: string) => `(${resolve(name)})`).replace(/px\b|rad\b/g, "").replace(/to-zero/g, "toZero").replace(/--fn(\d+)\(/g, "fn$1(");
    const bindings = { ...math, ...functions };
    for (const name of expression.replace(/\d+(?:\.\d+)?e[+-]?\d+/gi, "0").match(/[a-zA-Z_][a-zA-Z_0-9]*/g) ?? []) assert.ok(name in bindings, name);
    assert.match(expression, /^[\d\s.a-zA-Z_(),+*/-]+$/);
    return Function(...Object.keys(bindings), `return (${expression});`)(...Object.values(bindings));
  };
  // Resolve same-element declarations before falling back to inherited values.
  // A cycle is a real CSS error, even when a sequential interpreter would work.
  const scope = (declarations: Map<string, string>, inherited: Map<string, number>) => {
    const resolved = new Map<string, number>();
    const resolving = new Set<string>();
    const resolve = (name: string): number => {
      if (resolved.has(name)) return resolved.get(name)!;
      if (!declarations.has(name)) return inherited.get(name) ?? 0;
      assert.ok(!resolving.has(name), `CSS dependency cycle at ${name}`);
      resolving.add(name);
      const value = evaluate(declarations.get(name)!, resolve);
      resolving.delete(name);
      resolved.set(name, value);
      return value;
    };
    for (const name of declarations.keys()) resolve(name);
    return new Map([...inherited, ...resolved]);
  };
  const declarations = (body: string) => new Map([...body.matchAll(/--([a-z0-9]+): ([^;]+);/g)].map(match => [match[1], match[2]]));
  for (const match of html.matchAll(/@function --(fn\d+)\(([^)]*)\) returns <length> \{([^}]+)\}/g)) {
    const [, name, params, body] = match;
    functions[name] = (...args) => {
      const parameters = [...params.matchAll(/--(arg\d+)/g)].map((param, index) => [param[1], args[index]] as const);
      const locals = scope(declarations(body), new Map([...values, ...parameters]));
      return evaluate(body.match(/result: ([^;]+);/)![1], name => locals.get(name) ?? 0);
    };
  }
  for (const match of html.matchAll(/#capture-\d+ \{ --(v\d+): ([^;]+);/g)) {
    const [, id, width] = match;
    values.set(id, evaluate(width.replace(/100cqw/g, String(inputWidths.get(id))), name => name === "scale" ? inputScales.get(id)! : values.get(name) ?? 0));
  }
  for (const [, id, state] of html.matchAll(/\.computation:has\(#input-(\d+):(checked|active|valid)\) \{ --v\d+: 1px; \}/g)) {
    const label = decodeHtml(html.match(new RegExp(`<label[^>]+for="input-${id}"[^>]*>([^<]*)</label>`))![1]);
    const initial = state === "checked" && new RegExp(`<input id="input-${id}"[^>]* checked>`).test(html) ? 1 : 0;
    values.set(`v${id}`, label in inputs ? Number(Boolean(inputs[label])) : initial);
  }
  for (const [, state, id] of html.matchAll(/body:has\(#page-input:(checked|active)\) \.computation \{ --v(\d+): 1px; \}/g)) {
    values.set(`v${id}`, Number(Boolean(inputs[state === "checked" ? "click" : "press"])));
  }
  // Hold overrides are elapsed seconds, capped at the timer's duration.
  for (const [, id, duration] of html.matchAll(/@keyframes hold-(\d+) \{[^\n]*to \{ --held-\d+: ([\d.]+)px/g)) {
    const target = html.match(new RegExp(`:has\\(#(input|pad)-(\\d+):active\\) \\{ --hold-animation-${id}:`));
    const label = target ? decodeHtml(html.match(target[1] === "pad"
      ? new RegExp(`<span id="pad-label-${target[2]}"[^>]*>([^<]*)</span>`)
      : new RegExp(`<label[^>]+for="input-${target[2]}"[^>]*>([^<]*)</label>`))![1]) : "hold_time";
    values.set(`held-${id}`, Math.max(0, Math.min(Number(duration), inputs[label] ?? 0)));
  }
  // Scroll overrides are percentages; each axis can feed differently scaled values.
  for (const [, id, axis] of html.matchAll(/@keyframes scroll-(\d+)-([xy]) /g)) {
    const label = html.match(new RegExp(`<span id="pad-label-${id}"[^>]*>([^<]*)</span>`))?.[1];
    const key = label === undefined ? `arrow_${axis}` : `${decodeHtml(label)}.${axis}`;
    values.set(`scroll-${id}-${axis}`, Math.max(0, Math.min(100, inputs[key] ?? 0)));
  }
  const controls = html.match(/\.control-values \{([^}]+)\}/)?.[1];
  if (controls) for (const [id, width] of declarations(controls)) values.set(id, evaluate(width, name => values.get(name) ?? 0));
  const rules = new Map([...html.matchAll(/\.s(\d+) \{([^}]+)\}/g)].map(match => [match[1], declarations(match[2])]));
  const drawings: { kind: string; x: number; y: number; width: number; height: number; color: string }[] = [];
  const outputs: (string | number)[] = [];
  const readPrint = (id: string, body: string): string | number => {
    const choice = html.match(new RegExp(`\\.print-${id} \\{[^}]*--choice: var\\(--(v\\d+)\\)`));
    const index = choice ? values.get(choice[1])! : 0;
    const table = body.match(/class="text (text-table-\d+)"/);
    if (table) {
      const symbols = html.match(new RegExp(`@counter-style ${table[1]} \\{ system: fixed 0; symbols: (.*?); suffix:`))![1];
      const texts = [...symbols.matchAll(/"([^"]*)"/g)].map(match => match[1].replace(/\\([0-9a-f]{1,6}) /g, (_, code: string) => String.fromCodePoint(parseInt(code, 16))));
      assert.ok(index >= 0 && index < texts.length, `Missing string symbol ${index}`);
      return texts[index];
    }
    const selected = body.match(new RegExp(`<span class="print-${id}-choice-${index} ([^"]+)">(.*?)</span>`));
    assert.ok(selected, `Missing output branch ${index}`);
    if (choice) assert.ok(html.includes(`@container printed style(--choice: ${index}px) { .choice-${index} { display: block; } }`));
    if (selected[1].split(" ").includes("text")) return decodeHtml(selected[2]);
    const selector = choice ? `print-${id}-choice-${index}` : `print-${id}`;
    const value = html.match(new RegExp(`\\.${selector} \\{[^}]*--result: var\\(--(v\\d+)\\)`))!;
    const number = values.get(value[1])!;
    if (!selected[1].split(" ").includes("decimal")) return Math.round(number);
    const rounded = Math.round(Math.abs(number) * 1000) / 1000;
    return rounded === 0 ? 0 : Math.sign(number) * rounded;
  };
  for (const step of html.matchAll(/<div class="s(\d+)">|<div class="drawing-layer shape (\w+) shape-(\d+)">|<output class="print print-row print-(\d+)(?: conditional)?(?: runtime-error)?" data-label="[^"]*"(?: role="alert")?>(.*?)<\/output>/g)) {
    if (step[1]) {
      const computed = scope(rules.get(step[1])!, values);
      for (const [name, value] of computed) values.set(name, value);
    } else if (step[4]) {
      const visible = html.match(new RegExp(`\\.print-${step[4]} \\{ --print-visible: ([^;]+);`))?.[1] ?? "1px";
      if (evaluate(visible, name => values.get(name) ?? 0) > 0) outputs.push(readPrint(step[4], step[5]));
    } else {
      const body = html.match(new RegExp(`\\.shape-${step[3]}::after \\{([^}]+)\\}`))![1];
      const properties = new Map([...body.matchAll(/([a-z-]+): ([^;]+);/g)].map(match => [match[1], match[2]]));
      const value = (name: string) => evaluate(properties.get(name)!, name => values.get(name) ?? 0);
      if (value("opacity") > 0) drawings.push({ kind: step[2], x: value("left"), y: value("top"), width: value("width"), height: value("height"), color: properties.get("background")! });
    }
  }
  return { outputs, drawings };
}

function outputs(source: string, inputs: Record<string, number> = {}, options: CompilerOptions = {}, seconds = 0) {
  return evaluateProgram(source, inputs, options, seconds).outputs;
}

test("all examples compile to standalone, script-free documents", () => {
  for (const example of EXAMPLES) {
    const program = valid(example.source);
    // The clock demo is driven by time() alone.
    if (example.id !== "clock") assert.ok(program.inputs >= 1);
    assert.ok(program.outputs >= 1);
    assert.ok(program.html.startsWith("<!doctype html>"));
    assert.doesNotMatch(program.html, /<script\b|\son\w+=/i);
    assert.match(program.html, /script-src 'none'/);
    assert.match(program.html, /counter-reset: value calc\(var\(--result\) \/ 1px\)/);
  }
});

test("inputs and outputs keep numeric snapshots while local calculations are unregistered", () => {
  const program = valid('int a = input("a"); int b = a + 5; int c = a + b; print(c);');
  assert.equal(program.inputs, 1);
  assert.equal(program.variables, 3);
  assert.equal((program.html.match(/<textarea /g) || []).length, 1);
  assert.match(program.html, /--v2: [^;]*var\(--v0\)[^;]*var\(--v1\)/);
  assert.match(program.html, /@property --v0 \{ syntax: "<length>"/);
  assert.doesNotMatch(program.html, /@property --v1\b/);
  assert.match(program.html, /@property --v2 \{ syntax: "<length>"/);
});

test("HTML labels are escaped, including labels copied from print expressions", () => {
  const program = valid('int a = input("</textarea><script>alert(1)</script>"); print(a /* </style><script>x</script> */);');
  assert.doesNotMatch(program.html, /<script\b/i);
  assert.match(program.html, /&lt;script&gt;/);
});

test("reports the location of undefined references", () => {
  const result = compile('int a = 1;\nprint(missing);');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.line, 2);
  assert.equal(result.error.column, 7);
  assert.match(result.error.message, /Declare "missing"/);
});

test("rejects duplicate declarations, unknown functions, bad arity, and missing semicolons", () => {
  for (const source of [
    "int a = 1; int a = 2;",
    "int a = mystery(2);",
    "int a = min(1);",
    "int a = clamp(1, 2);",
    "int a = 1",
    "int a = 1 / 0;",
    "int a = 1000001;",
    'int a = 1 + input("a");',
    'int a = input("a);',
    "/* unfinished",
  ]) assert.equal(compile(source).ok, false, source);
});

test("comments, single-quoted inputs, default inputs, and empty programs work", () => {
  assert.equal(valid("// hello\n/* world */").variables, 0);
  const source = "int a = input('a'); print(a);";
  assert.equal(valid(source).inputs, 1);
  assert.deepEqual(outputs(source), [0]);
  assert.equal(valid(source).html, valid("int a = input('a', 0, 100); print(a);").html);
  assert.equal(valid("int a = input('a', 25); print(a);").html, valid("int a = input('a', 25, 100); print(a);").html);
  assert.deepEqual(outputs("int a = input('a', 100); print(a);"), [100]);
  assert.equal(compile("int a = input('a', 101);").ok, false);
  const program = valid("int a = input('a', 0); print(a + 2);");
  assert.equal(program.outputs, 1);
  assert.match(program.html, /#input-0 \{ anchor-name: --input-0; width: 32px;/);
});

test("toggle, held press, and typed inputs feed conditions, functions, loops, and arrays", () => {
  const source = `int enabled = toggle("enabled", true);
    int buttons[2] = {pressed("fire"), typed("key", "w")};
    int value(int a) { return a * 10; }
    int sum = 0;
    for (int i = 0; i < 3; i++) { if (enabled) { sum = sum + value(buttons[0]) + buttons[1]; } }
    print(sum); print(buttons); print(enabled);`;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, {}, { cssFunctions }), [0, 0, 0, 1]);
    assert.deepEqual(outputs(source, { fire: 1, key: 1 }, { cssFunctions }), [33, 1, 1, 1]);
    assert.deepEqual(outputs(source, { enabled: 0, fire: 1, key: 1 }, { cssFunctions }), [0, 1, 1, 0]);
    assert.deepEqual(outputs('int off = toggle("off"); int on = toggle("on", 1); print(off); print(on);', {}, { cssFunctions }), [0, 1]);
  }
});

test("scroll axes share a pad, scale independently, and truncate int inputs before arithmetic", () => {
  const source = `float x = scroll_x("move", 280); float y = scroll_y("move", 120);
    int whole = scroll_x("move", 10); float other = scroll_y("other");
    print(x); print(y); print(whole); print(whole * 2); print(other);`;
  const html = valid(source).html;
  assert.equal((html.match(/class="control scroll-input"/g) ?? []).length, 2);
  assert.equal((html.match(/@keyframes scroll-/g) ?? []).length, 3);
  assert.match(html, /timeline-scope: --pad-0-x, --pad-0-y, --pad-1-y/);
  assert.match(html, /scroll-unsupported/);
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, {}, { cssFunctions }), [0, 0, 0, 0, 0]);
    assert.deepEqual(outputs(source, { "move.x": 19, "move.y": 25, "other.y": 50 }, { cssFunctions }), [53.2, 30, 1, 2, 50]);
    assert.deepEqual(outputs(source, { "move.x": 100, "move.y": 100, "other.y": 100 }, { cssFunctions }), [280, 120, 10, 20, 100]);
  }
});

test("scroll input animations compose with clocks and remain running when clocks pause", () => {
  const source = `float n = input("n", 1); float x = scroll_x("move"); float t = time(8); print(n + x + t);`;
  const html = valid(source).html;
  assert.match(html, /animation-timeline: auto, --pad-0-x/);
  assert.match(html, /animation-play-state: var\(--clock-play, running\), running/);
  assert.match(html, /prefers-reduced-motion: reduce[^\n]+--clock-play: paused/);
  assert.deepEqual(outputs(source, { "move.x": 20 }, {}, 2), [23]);
});

test("global input APIs share one invisible page surface and preserve numeric types", () => {
  const source = `int a = click(); int b = click(); int held = press();
    float elapsed = hold_time(); int whole_seconds = hold_time(3);
    float x = arrow_x(280); float y = arrow_y(); int whole_x = arrow_x(10);
    print(a); print(b); print(held); print(elapsed); print(whole_seconds);
    print(x); print(y); print(whole_x);`;
  const html = valid(source).html;
  assert.equal((html.match(/id="page-input"/g) ?? []).length, 1);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, />Input<|class="control |class="input-label"/);
  assert.deepEqual(outputs(source), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(outputs(source, { click: 1, press: 1, hold_time: 2.7, arrow_x: 50, arrow_y: 25 }), [1, 1, 1, 1, 2, 140, 25, 5]);
  assert.match(valid('int p = press(); print(p);').html, /<button id="page-input"/);
  const mixed = 'float a = arrow_x(10); float b = scroll_x("", 20); int c = toggle("c"); print(a); print(b); print(c);';
  assert.deepEqual(outputs(mixed, { arrow_x: 50, ".x": 25, c: 1 }), [5, 5, 1]);
  for (const source of [
    'int a = click(1);', 'int a = click("a");', 'int a = press("a");',
    'float x = arrow_x(0);', 'float x = arrow_y(-1);', 'float x = arrow_x("x");',
    'float x = arrow_y(1, 2);', 'int n = 10; float x = arrow_x(n);',
    'float t = hold_time(0);', 'float t = hold_time(3601);', 'string a = click();',
    'int f() { int p = press(); return p; }',
  ]) assert.equal(compile(source).ok, false, source);
});



test("hold timers capture seconds, cap their duration, and compose with other inputs and clocks", () => {
  const source = `float elapsed = hold_time("jump", .9); int whole = hold_time("charge", 3);
    float default_timer = hold_time("default"); float x = scroll_x("move", 10);
    float t = time(8); print(elapsed); print(whole); print(default_timer); print(x + t);`;
  assert.deepEqual(outputs(source), [0, 0, 0, 0]);
  assert.deepEqual(outputs(source, { jump: .45, charge: 2.9, default: 5, "move.x": 50 }, {}, 2), [.45, 2, 1, 7]);
  assert.deepEqual(outputs(source, { jump: 2, charge: 5 }), [.9, 3, 0, 0]);
  const html = valid(source).html;
  assert.match(html, /var\(--hold-animation-0, none\) 0.9s linear forwards/);
  assert.match(html, /:has\(#input-0:active\) \{ --hold-animation-0: hold-0/);
  assert.match(html, /animation-timeline: auto, auto, auto, auto, --pad-0-x/);
  assert.match(html, /animation-play-state: (?:var\(--clock-play, running\), ){4}running/);
  assert.match(valid('float t = hold_time("jump"); print(t);').html, /id="pause-motion"/);
  for (const source of [
    'float t = hold_time("jump", 0);', 'float t = hold_time("jump", -1);',
    'float t = hold_time("jump", 3601);', 'float t = hold_time("jump", 1, 2);',
    'float n = 1; float t = hold_time("jump", n);', 'string t = hold_time("jump");',
    'print(hold_time("jump"));', 'float f() { float t = hold_time("jump"); return t; }',
  ]) assert.equal(compile(source).ok, false, source);
});

test("control labels and typed patterns are escaped without script or regex injection", () => {
  const label = '</style><script>&"';
  const source = `int a = toggle('${label}'); int b = pressed('${label}'); int c = typed('${label}', "|"); float d = scroll_x('${label}'); print(a + b + c + d);`;
  const html = valid(source).html;
  assert.doesNotMatch(html, /<script\b|\son\w+=/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /pattern="\\u007c"/);
  assert.match(valid('int w = typed("key", "w");').html, /pattern="\\u0077\|\\u0057"/);
});

test("new controls validate literal arguments, numeric storage, and top-level initialization", () => {
  for (const source of [
    'int a = toggle("a", 2);', 'int a = toggle("a", .5);', 'int a = toggle("a", 0, 1);',
    'int a = pressed("a", 1);', 'int a = typed("a");', 'int a = typed("a", "");',
    'int a = typed("a", "ab");', 'int a = typed("a", "😀");', 'int a = typed("a", 1);',
    'float a = scroll_x("a", 0);', 'float a = scroll_y("a", -1);', 'float a = scroll_x("a", 10, 20);',
    'int a = 10; float b = scroll_x("b", a);', 'int a = toggle(1);',
    'string a = toggle("a");', 'string a = pressed("a");', 'string a = typed("a", "w");', 'string a = scroll_x("a");',
    'int a = 1 + toggle("a");', 'print(pressed("a"));', 'int f() { int a = toggle("a"); return a; }',
    'if (false) { int a = typed("a", "w"); }', 'for (int i = 0; i < 0; i++) { float a = scroll_y("a"); }',
    'int a = 0; a = pressed("a");', 'int toggle = 1;',
  ]) for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
});

test("bounds source size, statement count, expression depth, and generated expression size", () => {
  assert.equal(compile(" ".repeat(20_001)).ok, false);
  assert.equal(compile(Array.from({ length: 129 }, (_, n) => `int a${n} = 1;`).join("\n")).ok, false);
  assert.equal(compile(`print(${"(".repeat(100)}1${")".repeat(100)});`).ok, false);
  let expression = "2";
  for (let n = 0; n < 25; n++) expression = `2 / (${expression})`;
  assert.equal(compile(`print(${expression});`).ok, false);
});

test("supports comparisons, boolean operators, conditional values, and numeric functions", () => {
  const program = valid(`
    int a = input("a", 80);
    int b = input("b", 120, 200);
    int smaller = a < b;
    int larger = a > b;
    int equal = a == b;
    int unequal = a != b;
    int bounds = a >= 0 && a <= b;
    int gate = (smaller && !equal) || (false || !true);
    int distance = abs(a - b);
    int chosen = gate ? distance : b;
    int nested = a > b ? a : a == b ? 0 : b;
    print(chosen);
    print(nested);
    print(round((a + b) / 3));
    print(ceil(a / b));
    print(floor(b / a));
    print(sign(-a) + 2);
    print(sqrt(a));
    print(hypot(a, b));
    print(mod(a, b));
    print(rem(a, b));
  `);
  assert.equal(program.inputs, 2);
  assert.equal(program.outputs, 10);
  assert.doesNotMatch(program.html, /<script\b|@container\b/);
});

test("both conditional branches are checked even when the condition is constant", () => {
  for (const source of [
    "print(false ? missing : 1);",
    "print(true ? 1 : missing);",
    "print(false ? 1 / 0 : 3);",
    "print(false && missing);",
  ]) assert.equal(compile(source).ok, false, source);
});

test("if is a statement keyword, and conditional expressions use the ternary operator", () => {
  for (const source of ['int c = if(2 > 1, 2, 1);', 'print(if(true, "yes", "no"));']) {
    const result = compile(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /condition \? yes : no/);
  }
  assert.equal(compile('int if = 1;').ok, false);
  assert.equal(compile('int if(int n) { return n; }').ok, false);
  assert.deepEqual(outputs('int c = 0; if (2 > 1) { c = 7; } print(c); print(2 > 1 ? 3 : 4); print("if");'), [7, 3, "if"]);
});

test("diagnoses malformed predicates, conditional syntax, and function arity", () => {
  for (const source of [
    "int true = 1;", "int and = 1;", "int abs = 1;",
    "print(1 === 1);", "print(1 & 1);", "print(1 <);",
    "print(1 ? 2);", "print(1 ? : 3);", "print(1 ? 2 :);",
    "print(if(1, 2));", "print(abs(1, 2));", "print(round());",
    "print(mod(1, 0));", "print(rem(1, 0));",
  ]) assert.equal(compile(source).ok, false, source);
  const result = compile("int a = 1;\nprint(a > unknown ? a : 0);");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.line, 2);
    assert.equal(result.error.column, 11);
  }
});

test("limits unary, ternary, and repeated boolean expansion without overflowing the stack", () => {
  assert.equal(compile(`print(${"!".repeat(100)}true);`).ok, false);
  let expression = "true";
  for (let index = 0; index < 30; index++) expression = `(${expression} ? 1 : 0)`;
  assert.equal(compile(`print(${expression});`).ok, false);
});

test("reassignment snapshots values and conditions, merges branches, and respects block scope", () => {
  const source = `
    int a = input("a", 2, 20);
    int b = a;
    if (a < 5) {
      a = 10;
      b = a + 1;
      int a = 99;
    } else if (a == 5) {
      b = 50;
    } else {
      a = a + 1;
    }
    print(a); print(b);
    a = 0;
    print(b);
  `;
  assert.deepEqual(outputs(source, { a: 2 }), [10, 11, 11]);
  assert.deepEqual(outputs(source, { a: 5 }), [5, 50, 50]);
  assert.deepEqual(outputs(source, { a: 8 }), [9, 8, 8]);
});

test("functions inline separate calls, nested calls, forward references, and early returns", () => {
  const source = `
    int n = input("n", 1, 20);
    int choose(int x) {
      if (x < 3) { return twice(x); }
      x = x + 1;
      if (x > 10) { return 100; } else { x = x + 2; }
      return x;
    }
    int twice(int x) { return x * 2; }
    int constant() { return 7; }
    print(choose(n)); print(choose(5)); print(constant()); print(n);
  `;
  assert.deepEqual(outputs(source, { n: 1 }), [2, 8, 7, 1]);
  assert.deepEqual(outputs(source, { n: 5 }), [8, 8, 7, 5]);
  assert.deepEqual(outputs(source, { n: 15 }), [100, 8, 7, 15]);
});

test("modulo uses CSS mod semantics, multiplicative precedence, and a zero-safe live divisor", () => {
  const source = 'int b = input("b", 3, 10); print(11 % b); print(-5 % b); print(2 + 11 % 4 * 3);';
  assert.deepEqual(outputs(source, { b: 3 }), [2, 1, 11]);
  assert.deepEqual(outputs(source, { b: 0 }), [0, 0, 11]);
  assert.equal(compile("print(5 % 0);").ok, false);
});

test("bounded loops carry assignments, isolate locals, skip empty ranges, and preserve early returns", () => {
  assert.deepEqual(outputs(`
    int total = 1;
    for (int i = 1; i <= 5; i = i + 2) { int add = i; total = total + add; }
    for (int i = 2; i < 2; i++) { total = 0; }
    int first(int n) {
      for (int i = 0; i < 5; i++) { if (i == n) { return i + 10; } }
      return 99;
    }
    print(total); print(first(2)); print(first(8));
  `), [10, 12, 99]);
});

test("demo outputs cover defaults, boundaries, and changing inputs", () => {
  const clock = EXAMPLES.find(example => example.id === "clock")!.source;
  // time() loops every 60s; the 3600s clock keeps counting into minutes.
  const [loop, ...digits] = outputs(clock, {}, {}, 65.37);
  assert.ok(Math.abs(Number(loop) - 5.37) < 0.01, String(loop));
  assert.deepEqual(digits, [1, 5, 37]);
  // 01:05.37 lights 6+2+6+5+5+3 segments, plus the colon and decimal point.
  const lit = evaluateProgram(clock, {}, {}, 65.37).drawings.filter(shape => shape.color === "#9fe870");
  assert.equal(lit.length, 30);
  assert.deepEqual(EXAMPLES.map(example => example.id), ["clock", "addition", "rsa", "gcd", "fibonacci", "prime", "fizzbuzz", "sorting", "temperature", "geometry", "orbit", "wave", "collatz"]);
  assert.deepEqual(outputs(EXAMPLES.find(example => example.id === "addition")!.source), [200]);
  for (const [n, expected] of [[0, 0], [1, 1], [5, 5], [10, 55]]) {
    assert.deepEqual(outputs(EXAMPLES.find(example => example.id === "fibonacci")!.source, { n }), [expected]);
  }
  for (const [n, expected] of [[0, 0], [1, 2], [10, 29], [20, 71]]) {
    assert.deepEqual(outputs(EXAMPLES.find(example => example.id === "prime")!.source, { n }), [expected]);
  }
  const wave = EXAMPLES.find(example => example.id === "wave")!.source;
  for (const points of [0, 1, 24]) {
    const result = evaluateProgram(wave, { points }, {}, 1.5);
    const circles = result.drawings.filter(shape => shape.kind === "circle");
    assert.equal(circles.length, points);
    assert.equal(result.drawings.filter(shape => shape.kind === "line").length, Math.max(1, points));
    for (const circle of circles) assert.ok(Math.abs(circle.y - (120 + Math.sin(circle.x / 296 * 6.28318530718 - 1.5 * 6.28318530718 / 6) * 55)) < .0001);
  }
});

test("RSA round-trips messages including zero, prime factors, and the upper bound", () => {
  const source = EXAMPLES.find(example => example.id === "rsa")!.source;
  assert.deepEqual(outputs(source), [81, 42]);
  for (const cssFunctions of [false, true]) {
    for (const message of [0, 1, 11, 13, 100, 142]) {
      const encrypted = Number(BigInt(message) ** 7n % 143n);
      assert.deepEqual(outputs(source, { message }, { cssFunctions }), [encrypted, message]);
    }
  }
});

test("FizzBuzz selects strings and a live numeric fallback in either function mode", () => {
  const source = EXAMPLES.find(example => example.id === "fizzbuzz")!.source;
  for (const cssFunctions of [false, true]) {
    for (const n of [0, 1, 3, 5, 15, 29, 30, 99, 100]) {
      const expected = n % 15 === 0 ? "FizzBuzz" : n % 3 === 0 ? "Fizz" : n % 5 === 0 ? "Buzz" : n;
      assert.deepEqual(outputs(source, { n }, { cssFunctions }), [expected]);
    }
  }
  const html = valid(source).html;
  const branches = (html.match(/@container printed style\(/g) ?? []).length;
  assert.ok(branches <= 5);
  assert.equal((valid(source.replace('15, 100', '15, 1000')).html.match(/@container printed style\(/g) ?? []).length, branches);
});

test("text output escapes markup and supports numeric functions, nesting, and empty strings", () => {
  const source = String.raw`
    int n = input("n", 2, 10);
    int twice(int x) { return x * 2; }
    print("</style><script>&\"\\");
    print(n < 3 ? (n == 0 ? "" : twice(n)) : "large");
    print("&&"); print('or');
    n = 10;
    print(n);
  `;
  for (const cssFunctions of [false, true]) {
    for (const [n, expected] of [[0, ""], [2, 4], [5, "large"]] as const) {
      assert.deepEqual(outputs(source, { n }, { cssFunctions }), ['</style><script>&"\\', expected, "&&", "or", 10]);
    }
  }
  assert.doesNotMatch(valid(source).html, /<script\b/i);
  assert.match(valid(source).html, /&lt;\/style&gt;&lt;script&gt;&amp;&quot;\\/);
});

test("strings cannot enter numeric storage, conditions, operations, or function arguments", () => {
  for (const source of [
    'int n = "hello";', 'int n = 1; n = "hello";',
    'print("a" + "b");', 'print("a" ? 1 : 2);',
    'int n = true ? "hello" : 2;', 'print(abs("a"));',
    'int f() { return "a"; }', 'int f(int n) { return n; } print(f("a"));',
    'print(true ? "yes" : missing);', 'print(false ? 1 / 0 : "no");',
  ]) {
    for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
  }
});

test("symbolic booleans preserve precedence and diagnose removed word operators", () => {
  assert.deepEqual(outputs('print(1 || 0 && 0); print((1 || 0) && 0); print(-1 && 2); print(!2); print(!0);'), [1, 0, 1, 0, 1]);
  for (const [word, symbol] of [["and", "&&"], ["or", "||"], ["not", "!"]]) {
    const result = compile(word === "not" ? "print(not 0);" : `print(1 ${word} 0);`);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.message, `Use ${symbol} instead of ${word}.`);
  }
  assert.deepEqual(outputs('print("not");'), ["not"]);
});

test("outputs avoid the container-unit precision loss that displayed 29 as 28", () => {
  const source = 'int n = input("n", 29, 200); print(n); print(29); print(57); print(58);';
  assert.deepEqual(outputs(source), [29, 29, 57, 58]);
  assert.deepEqual(outputs(source, { n: 28.984375 }), [28, 29, 57, 58]);
  assert.match(valid(source).html, /counter-reset: value calc\(var\(--result\) \/ 1px\)/);
  assert.doesNotMatch(valid(source).html, /counter-reset:[^;]*100cqw/);
});

test("unused values are omitted and loop rule counts stay constant", () => {
  const program = valid('int unused = 100; int used = 29; print(used);');
  assert.doesNotMatch(program.html, /@property --v0\b/);
  assert.match(program.html, /@property --v1\b/);
  const budgets = new Map([["rsa", 31], ["fibonacci", 19], ["prime", 42], ["fizzbuzz", 6]]);
  for (const example of EXAMPLES) {
    const budget = budgets.get(example.id);
    if (budget === undefined) continue;
    const html = valid(example.source).html;
    assert.doesNotMatch(html, /class="value"/);
    assert.ok((html.match(/@property --v/g) ?? []).length <= budget, example.id);
  }
});

test("registration checkpoints bound repeated substitutions and every inherited state read is typed", () => {
  const source = [
    'int n = input("n", 7);', 'int v0 = n;',
    ...Array.from({ length: 40 }, (_, index) => `int v${index + 1} = (v${index} + v${index}) % 97;`),
    'print(v40);',
  ].join('\n');
  assert.deepEqual(outputs(source), [Number(7n * 2n ** 40n % 97n)]);
  const html = valid(source).html;
  const registrations = [...html.matchAll(/@property --v\d+\b/g)].length;
  assert.ok(registrations > 2 && registrations < 20);

  // Materialize token substitution independently of the compiler's cost model.
  // Registered dependencies contribute one number; local dependencies retain
  // their whole expression. Missing a checkpoint would expand exponentially.
  for (const document of [html, ...EXAMPLES.map(example => valid(example.source).html)]) {
    const registered = new Set([...document.matchAll(/@property --(v\d+)\b/g)].map(match => match[1]));
    for (const [, body] of document.matchAll(/\.s\d+ \{([^}]+)\}/g)) {
      const declarations = new Map([...body.matchAll(/--(v\d+): ([^;]+);/g)].map(match => [match[1], match[2]]));
      const expanded = new Map<string, string>();
      const substitute = (name: string): string => {
        if (expanded.has(name)) return expanded.get(name)!;
        assert.ok(declarations.has(name), `Unregistered inherited read: ${name}`);
        const expression = declarations.get(name)!.replace(/var\(--(v\d+)\)/g, (_, dependency: string) => registered.has(dependency) ? '1000000px' : substitute(dependency));
        assert.ok(expression.length < 65_536, `Expression expansion at ${name}: ${expression.length}`);
        expanded.set(name, expression);
        return expression;
      };
      for (const name of declarations.keys()) substitute(name);
    }
  }
});

test("diagnoses invalid scopes, returns, calls, and loop bounds, including unused code", () => {
  for (const source of [
    'a = 1;', 'if (true) { int a = 1; } print(a);',
    'if (false) { missing = 2; }',
    'if (true) { int n = input("n"); }', 'return 1;',
    'int f(int a, int a) { return a; }', 'int f() { return missing; }',
    'int f(int x) { if (x) { return 1; } }',
    'int f() { return 1; } print(f(1));',
    'int f() { return 1 + f(); }', 'int f() { return g(); } int g() { return f(); }',
    'int n = 1; int f() { return n; }', 'int f() { return 1; } int f() { return 2; }',
    'int f() { int g() { return 1; } return 2; }',
    'for (int i = 0; i < 129; i++) {}',
    'int n = 5; for (int i = 0; i < n; i++) {}',
    'for (int i = 0; i < 5; i = i + 0) {}',
    'for (int i = 0; i < 5; i++) { i = 0; }',
    'for (int i = 0; i < 0; i++) { missing = 1; }',
    'for (int i = 0; i < 128; i++) { for (int j = 0; j < 128; j++) { int a = i + j; } }',
    'if (true) {', 'int f(int', 'int f() { return 1;',
  ]) assert.equal(compile(source).ok, false, source);
});


test("increasing a loop bound repeats HTML without growing CSS", () => {
  const source = (limit: number) => `int n = input("n", 3, 100); int total = 0; for (int i = 0; i < ${limit}; i++) { if (i < n) { total = total + i; } } print(total);`;
  const small = valid(source(10)).html;
  const large = valid(source(100)).html;
  assert.equal(small.match(/<style>([\s\S]*?)<\/style>/)![1], large.match(/<style>([\s\S]*?)<\/style>/)![1]);
  assert.ok((large.match(/<div class="s/g) ?? []).length > (small.match(/<div class="s/g) ?? []).length);
  assert.deepEqual(outputs(source(100)), [3]);
});

test("nested loop state and branches preserve outer snapshots with either loop parity", () => {
  const source = `
    int a = input("a", 2, 10);
    int b = a;
    if (a < 5) {
      for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 2; j++) { a = a + 1; }
      }
    } else { for (int i = 0; i < 2; i++) { b = b + 10; } }
    print(a); print(b);
  `;
  assert.deepEqual(outputs(source, { a: 2 }), [8, 2]);
  assert.deepEqual(outputs(source, { a: 7 }), [7, 27]);
});

test("native CSS functions share definitions and match portable calls and early returns", () => {
  const source = `
    int n = input("n", 5, 20);
    int twice(int x) { return x * 2; }
    int choose(int x) { if (x < 3) { return twice(x); } x = x + 1; if (x > 10) { return 100; } return x; }
    int constant() { return 7; }
    int repeated(int n) { int x = 0; for (int i = 0; i < 5; i++) { x = x + choose(n); } return x; }
    print(choose(n)); print(choose(2)); print(repeated(n)); print(constant());
  `;
  const native = valid(source, { cssFunctions: true }).html;
  assert.equal((native.match(/@function /g) ?? []).length, 3);
  assert.doesNotMatch(valid(source).html, /@function /);
  for (const n of [0, 1, 5, 15]) assert.deepEqual(outputs(source, { n }, { cssFunctions: true }), outputs(source, { n }));
  for (const example of EXAMPLES) assert.deepEqual(outputs(example.source, {}, { cssFunctions: true }), outputs(example.source));
});

test("native mode still diagnoses invalid and non-tail recursive definitions", () => {
  for (const source of ['int f() { return 1 + f(); }', 'int f(int a, int a) { return a; }', 'int f() { return missing; }', 'int f(int x) { if (x) { return 1; } }', 'int f() { return 1; } print(f(2));']) {
    assert.equal(compile(source, { cssFunctions: true }).ok, false, source);
  }
});

test("tail-recursive GCD updates arguments simultaneously and follows live inputs", () => {
  const source = EXAMPLES.find(example => example.id === "gcd")!.source;
  assert.equal(valid(source).outputs, 1);
  for (const cssFunctions of [false, true]) {
    for (const [a, b, expected] of [[84, 30, 6], [0, 0, 0], [0, 17, 17], [200, 0, 200], [89, 55, 1], [144, 120, 24]]) {
      assert.deepEqual(outputs(source, { a, b }, { cssFunctions, recursionSteps: 16 }), [expected]);
    }
    assert.doesNotMatch(valid(source, { cssFunctions }).html, /@function /);
  }
});

test("tail returns support ternaries, fresh locals, typed arguments, and shadowing", () => {
  const fib = `int fib(int n, int a, int b) { return n == 0 ? a : fib(n - 1, b, a + b); } print(fib(10, 0, 1));`;
  const typed = `float walk(int n, float total, string word) {
    float local[2] = {1.25};
    print(word); print(local[1]); local[1] = 9;
    if (n == 0) { return total; }
    return walk(n - 1, total + local[0], word == "a" ? "b" : "a");
  } print(walk(2, .5, "a"));`;
  const shadow = `int f(int n, int result) {
    if (n > 0) { int n = 1; return f(n - 1, result + 7); }
    return result;
  } print(f(9, 0));`;
  for (const cssFunctions of [false, true]) {
    const options = { cssFunctions, recursionSteps: 12 };
    assert.deepEqual(outputs(fib, {}, options), [55]);
    assert.deepEqual(outputs(typed, {}, options), ["a", 0, "b", 0, "a", 0, 3]);
    assert.deepEqual(outputs(shadow, {}, options), [7]);
    assert.deepEqual(outputs('string flip(int n, string s) { return n == 0 ? s : flip(n - 1, s == "a" ? "b" : "a"); } print(flip(3, "a"));', {}, options), ["b"]);
  }
});

test("tail calls inside loops skip the remaining body and preserve print and draw order", () => {
  const source = `int descend(int n) {
    for (int i = 0; i < 2; i++) {
      if (i == 0) { continue; }
      print(n); circle(n * 10, 10, 2);
      if (n > 0) { return descend(n - 1); }
      break;
      print(999);
    }
    return 42;
  }
  print(descend(2)); print(7);`;
  for (const cssFunctions of [false, true]) {
    const result = evaluateProgram(source, {}, { cssFunctions, recursionSteps: 4 });
    assert.deepEqual(result.outputs, [2, 1, 0, 42, 7]);
    assert.deepEqual(result.drawings.map(shape => shape.x), [20, 10, 0]);
  }
});

test("recursion budgets include the initial call and errors propagate through callers", () => {
  const source = `int n = input("n", 2, 10);
  int down(int n) { print(n); if (n == 0) { return 9; } return down(n - 1); }
  int wrapper(int n) { int result = down(n); print(123); return result; }
  print("before"); print(wrapper(n)); print("after"); circle(20, 20, 2);`;
  for (const cssFunctions of [false, true]) {
    const options = { cssFunctions, recursionSteps: 3 };
    assert.deepEqual(outputs(source, { n: 2 }, options), ["before", 2, 1, 0, 123, 9, "after"]);
    const failed = evaluateProgram(source, { n: 3 }, options);
    assert.deepEqual(failed.outputs, ["before", 3, 2, 1, "Recursion limit reached in down (3 calls)."]);
    assert.deepEqual(failed.drawings, []);
    assert.deepEqual(outputs(source, { n: 0 }, { cssFunctions, recursionSteps: 1 }), ["before", 0, 123, 9, "after"]);
    assert.match(valid(source, options).html, /runtime-error" data-label="Runtime error" role="alert"/);
  }
});

test("inactive recursive calls never fail and failure suppresses later expression effects", () => {
  const definitions = `int spin() { return spin(); }
    int show() { print("called"); return 1; }
    int skip() { return 7; spin(); }
    int n = input("n", 0, 1);`;
  for (const cssFunctions of [false, true]) {
    const options = { cssFunctions, recursionSteps: 2 };
    const inactive = definitions + `if (false) { spin(); }
      print(n ? spin() : 8); print(n && spin()); print(!n || spin()); print(skip()); print("end");`;
    assert.deepEqual(outputs(inactive, { n: 0 }, options), [8, 0, 1, 7, "end"]);
    assert.deepEqual(outputs(inactive, { n: 1 }, options), ["Recursion limit reached in spin (2 calls)."]);
    for (const expression of ['spin() + show()', 'spin() ? show() : show()', 'show() + spin()']) {
      const expected = expression.startsWith('show') ? ["called", "Recursion limit reached in spin (2 calls)."] : ["Recursion limit reached in spin (2 calls)."];
      assert.deepEqual(outputs(definitions + `print(${expression}); print("after");`, {}, options), expected);
    }
    assert.deepEqual(outputs('int unused() { return unused(); } print(7);', {}, options), [7]);
    assert.deepEqual(outputs('int spin() { return spin(); } for (int i = 0; i < 2; i++) { spin(); print(i); } print(7);', {}, options), ["Recursion limit reached in spin (2 calls)."]);
  }
});

test("tail recursion reuses rules and registrations as its budget grows", () => {
  const source = `int sum(int n, int total) { return n == 0 ? total : sum(n - 1, total + n); } print(sum(3, 0));`;
  const small = valid(source, { recursionSteps: 8 }).html;
  const large = valid(source, { recursionSteps: 32 }).html;
  for (const pattern of [/@property /g, /\.s\d+ \{/g, /\{/g]) {
    assert.equal([...large.matchAll(pattern)].length, [...small.matchAll(pattern)].length);
  }
  assert.ok(large.length > small.length);
  assert.deepEqual(outputs(source, {}, { recursionSteps: 8 }), [6]);
});

test("recursion rejects non-tail calls, mutual calls, invalid returns, and invalid budgets", () => {
  for (const source of [
    'int f() { return 1 + f(); }',
    'int f(int n) { return f(f(n)); }',
    'int f() { int n = f(); return n; }',
    'int f() { f(); return 0; }',
    'int f() { return g(); } int g() { return f(); }',
    'int f() { if (false) { return 1 + f(); } return 0; }',
    'int f(int n) { if (n > 0) { return f(n - 1); } }',
    'int f(int n) { return f("bad"); }',
    'int f(int n) { int n = 0; return f(n); }',
    'int f() { break; return f(); }',
    'int f() { continue; return f(); }',
  ]) for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
  for (const recursionSteps of [0, -1, 1.5, 129, NaN, Infinity]) assert.equal(compile('print(1);', { recursionSteps }).ok, false);
});


test("break freezes the nearest loop and continue skips only the current iteration", () => {
  const source = `
    int n = input("n", 5, 10);
    int total = 0;
    for (int i = 0; i < 10; i++) {
      if (i >= n) { break; }
      if (i % 2 == 0) { continue; }
      total = total + i;
    }
    total = total + 100;
    print(total);
  `;
  for (const cssFunctions of [false, true]) {
    for (const [n, expected] of [[0, 100], [1, 100], [5, 104], [10, 125]]) assert.deepEqual(outputs(source, { n }, { cssFunctions }), [expected]);
  }
});

test("nested loop controls remain local and skipped inner loops cannot mutate outer state", () => {
  assert.deepEqual(outputs(`
    int total = 0;
    for (int i = 0; i < 3; i++) {
      if (i == 1) { continue; }
      for (int j = 0; j < 4; j++) {
        if (j == 0) { continue; }
        if (j == 2) { break; }
        total = total + 1;
      }
      total = total + 10;
    }
    print(total);
  `), [22]);
});

test("loop jumps suppress later returns while later iterations and post-loop returns still work", () => {
  const source = `
    int n = input("n", 2, 4);
    int choose(int n) {
      for (int i = 0; i < 4; i++) {
        if (i < n) { continue; }
        if (i == 3) { break; }
        return i + 10;
      }
      return 99;
    }
    print(choose(n));
  `;
  for (const [n, expected] of [[0, 10], [2, 12], [3, 99], [4, 99]]) assert.deepEqual(outputs(source, { n }), [expected]);
  assert.deepEqual(outputs('int f() { for (int i = 0; i < 1; i++) { return 7; break; } } print(f());'), [7]);
});

test("loop control does not add rules when the iteration bound increases", () => {
  const source = (limit: number) => `int n = input("n", 5, 100); int total = 0; for (int i = 0; i < ${limit}; i++) { if (i >= n) { break; } if (i % 2 == 0) { continue; } total = total + i; } print(total);`;
  const css = (limit: number) => valid(source(limit)).html.match(/<style>([\s\S]*?)<\/style>/)![1];
  assert.equal(css(10), css(100));
  assert.deepEqual(outputs(source(100)), [4]);
});

test("diagnoses jumps outside loops and paths that jump past the only return", () => {
  for (const source of [
    'break;', 'continue;', 'if (true) { break; }',
    'int break = 1;', 'int continue = 1;',
    'for (int i = 0; i < 1; i++) { break }',
    'int f() { continue; return 1; } for (int i = 0; i < 1; i++) { int a = f(); }',
    'int f() { for (int i = 0; i < 1; i++) { break; return 1; } }',
    'int f() { for (int i = 0; i < 1; i++) { continue; return 1; } }',
    'int f(int n) { for (int i = 0; i < 1; i++) { if (n) { break; } return 1; } }',
  ]) {
    for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
  }
  valid('for (int i = 0; i < 0; i++) { break; continue; }');
});

test("arrays initialize, zero-fill, print snapshots, and keep block declarations local", () => {
  const source = `
    int values[4] = {input("a", 7), 2,};
    int zero[2];
    print(values);
    if (true) {
      values[1] = values[0] + 3;
      int values[2] = {90, 91};
      values[0] = 99;
    }
    print(values); print(zero);
    int one[1] = {5}; print(one);
  `;
  const program = valid(source);
  assert.equal(program.inputs, 1);
  assert.equal(program.variables, 3);
  assert.deepEqual(outputs(source), [7, 2, 0, 0, 7, 10, 0, 0, 0, 0, 5]);
  assert.deepEqual(outputs(source, { a: 20 }), [20, 2, 0, 0, 20, 23, 0, 0, 0, 0, 5]);
});

test("live array indices round down, preserve assignment order, and handle bounds", () => {
  const source = `
    int n = input("n", 0, 10);
    int a[3] = {10, 20, 30};
    print(a[n - 1]);
    a[n - 1] = 99;
    print(a);
  `;
  for (const [n, expected] of [
    [0, [0, 10, 20, 30]], [1, [10, 99, 20, 30]],
    [3, [30, 10, 20, 99]], [4, [0, 10, 20, 30]],
  ] as const) assert.deepEqual(outputs(source, { n }), expected);
  assert.deepEqual(outputs(`
    int a[3] = {1, 2, 3};
    a[a[0]] = a[a[0]] + 10;
    print(a);
    a[3 / 2] = 8;
    print(a[3 / 2]);
    a[-1 / 2] = 9;
    a[1000000 * 2] = 9;
    print(a);
  `), [1, 12, 3, 8, 1, 8, 3]);
});

test("array banks carry through nested loops, branches, break, and continue", () => {
  assert.deepEqual(outputs(`
    int a[3];
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 4; j++) {
        if (j == 0) { continue; }
        if (j == 3) { break; }
        a[i] = a[i] + j;
      }
    }
    print(a);
  `), [3, 3, 3]);
  const source = `
    int n = input("n", 0, 1);
    int a[2] = {1, 2};
    if (n) {
      for (int i = 0; i < 3; i++) { a[i % 2] = a[i % 2] + 1; }
    } else { a[1] = 9; }
    print(a);
  `;
  assert.deepEqual(outputs(source, { n: 0 }), [1, 9]);
  assert.deepEqual(outputs(source, { n: 1 }), [3, 3]);
});

test("function-local arrays work with native functions, indexed loop calls, and early returns", () => {
  const source = `
    int n = input("n", 1, 4);
    int index(int n) {
      int result = 0;
      for (int i = 0; i < 3; i++) { result = result + n; }
      return result % 3;
    }
    int choose(int n) {
      int a[3] = {10, 20, 30};
      a[n - 1] = 99;
      if (n == 0) { return a[0]; }
      a[0] = 5;
      return a[n - 1];
    }
    int use_index(int n) {
      int a[2] = {10, 20};
      a[index(n)] = 7;
      return a[index(n)];
    }
    int first(int n) {
      int a[2] = {3, 4};
      for (int i = 0; i < 3; i++) {
        if (i < n) { continue; }
        a[i % 2] = 10;
        return a[0] + a[1];
      }
      return a[0] + a[1];
    }
    print(choose(n)); print(use_index(n)); print(first(n));
  `;
  for (const cssFunctions of [false, true]) {
    for (const [n, expected] of [[0, [10, 7, 14]], [1, [5, 7, 13]], [2, [99, 7, 14]], [4, [0, 7, 7]]] as const) {
      assert.deepEqual(outputs(source, { n }, { cssFunctions }), expected);
    }
  }
  const native = valid(source, { cssFunctions: true }).html;
  assert.equal((native.match(/@function /g) ?? []).length, 1);
});

test("bubble sort reacts to input permutations, duplicates, zeros, and extremes", () => {
  const source = EXAMPLES.find(example => example.id === "sorting")!.source;
  assert.deepEqual(outputs(source), [9, 18, 45, 63, 72]);
  for (const cssFunctions of [false, true]) {
    for (const values of [[1, 2, 3, 4, 5], [100, 75, 50, 25, 0], [9, 9, 0, 9, 0], [0, 0, 0, 0, 0]]) {
      const inputs = Object.fromEntries(values.map((value, index) => [String.fromCharCode(97 + index), value]));
      assert.deepEqual(outputs(source, inputs, { cssFunctions }), values.toSorted((a, b) => a - b));
    }
  }
});

test("short indexed loops preserve bounds, steps, and element types", () => {
  assert.deepEqual(outputs(`
    int values[3] = {10, 20, 30};
    int sum = 0;
    for (int i = 0; i < 6; i++) {
      sum = sum + values[i];
      values[i] = values[i] + 1;
    }
    print(sum); print(values);
    float fractions[5];
    for (int i = 1; i < 6; i = i + 2) { fractions[i - 1] = i + .25; }
    print(fractions);
    string words[2] = {"a", "b"};
    string last = "unchanged";
    for (int i = 0; i < 3; i++) { last = words[i]; words[i] = "x"; }
    print(last); print(words);
  `), [60, 11, 21, 31, 1.25, 0, 3.25, 0, 5.25, "", "x", "x"]);
});

test("specialized array loops preserve jumps, returns, and fresh locals", () => {
  const source = `
    int n = input("n", 4, 6);
    int choose(int n) {
      int values[6] = {10, 20, 30, 40, 50, 60};
      int sum = 0;
      for (int i = 0; i < 6; i++) {
        if (i == n) { break; }
        if (i % 2 == 0) { continue; }
        int local = values[i];
        sum = sum + local;
        if (sum > 50) { return sum; }
        values[i] = 0;
      }
      return sum + values[3];
    }
    print(choose(n));
  `;
  for (const cssFunctions of [false, true]) {
    for (const [n, expected] of [[0, 40], [2, 60], [4, 60], [6, 60]]) {
      assert.deepEqual(outputs(source, { n }, { cssFunctions }), [expected]);
    }
  }
});

test("counter shadowing and live offsets keep reusable array loops", () => {
  const shadowed = (limit: number) => `
    int a[3];
    for (int i = 0; i < ${limit}; i++) {
      int i = 1;
      a[i] = a[i] + 1;
    }
    print(a);
  `;
  const dynamic = (limit: number) => `
    int offset = input("offset", 1, 2);
    int a[3];
    for (int i = 0; i < ${limit}; i++) {
      a[i % 3] = a[i % 3] + 1;
      a[(i + offset) % 3] = a[(i + offset) % 3] + 10;
    }
    print(a);
  `;
  const css = (source: string) => valid(source).html.match(/<style>([\s\S]*?)<\/style>/)![1];
  for (const source of [shadowed, dynamic]) assert.equal(css(source(2)), css(source(6)));
  assert.deepEqual(outputs(shadowed(6)), [0, 6, 0]);
  assert.deepEqual(outputs(dynamic(2)), [1, 11, 10]);
  assert.deepEqual(outputs(dynamic(6)), [22, 22, 22]);
});

test("bubble sort specializes adjacent indices while reusing outer-pass rules", () => {
  const source = EXAMPLES.find(example => example.id === "sorting")!.source;
  const html = valid(source).html;
  assert.ok((html.match(/<div class="s\d+">/g) ?? []).length <= 5);
  assert.ok((html.match(/@property --v\d+\b/g) ?? []).length <= 33);
  assert.ok((html.match(/<div\b/g) ?? []).length <= 26);
  const longer = valid(source.replace("pass < 4", "pass < 8")).html;
  assert.equal(html.match(/<style>([\s\S]*?)<\/style>/)![1], longer.match(/<style>([\s\S]*?)<\/style>/)![1]);
  assert.ok((longer.match(/<div class="s\d+">/g) ?? []).length > 5);
});

test("array loop rules and registrations do not grow with the iteration bound", () => {
  const source = (limit: number) => `int a[3] = {1, 2, 3}; for (int i = 0; i < ${limit}; i++) { a[i % 3] = a[i % 3] + 1; } print(a);`;
  const css = (limit: number) => valid(source(limit)).html.match(/<style>([\s\S]*?)<\/style>/)![1];
  assert.equal(css(10), css(100));
  assert.deepEqual(outputs(source(10)), [5, 5, 6]);
});

test("array diagnostics reject invalid shapes, types, scopes, and literal indices", () => {
  for (const source of [
    'int a[0];', 'int a[33];', 'int n = 2; int a[n];', 'int a[] = {1};',
    'int a[2] = {1, 2, 3};', 'int a[2] = {1;', 'int a[2] = {"a"};',
    'int a[2]; int a = 1;', 'int a = 1; int a[2];',
    'int a[2]; a = 3;', 'int a = 1; print(a[0]);', 'int a = 1; a[0] = 2;',
    'int a[2]; print(a + 1);', 'int a[2]; if (a) {}',
    'int a[2]; print(a[2]);', 'int a[2]; print(a[-1]);', 'int a[2]; a[2] = 1;',
    'int a[2]; print(a["x"]);', 'int a[2]; a["x"] = 1;', 'int a[2]; a[0] = "x";',
    'if (true) { int a[2]; } print(a);', 'int a[2] = {a[0]};',
    'int f() { int a[2]; return a; }', 'int f(int x) { return x; } int a[2]; print(f(a));',
    'int f(int a[2]) { return a[0]; }',
    'int f() { int a[2] = {input("a")}; return a[0]; }',
    'if (false) { int a[2] = {input("a")}; }',
    'int a[2]; for (int i = 0; i < 0; i++) { a[2] = 1; }',
  ]) for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
});

test("signed integers truncate toward zero and floats retain fractions across calls, loops, and arrays", () => {
  const source = `
    int whole = -2.9;
    float fraction = -.125;
    float adjust(float x) {
      float y = x / 2;
      for (int i = 0; i < 3; i++) { y = y + .25; }
      return y;
    }
    float native(float x) { if (x < 0) { return x / 2; } return x + .25; }
    int integer(int x) { return x; }
    float a[2] = {-0.5, 1.25};
    for (int i = 0; i < 2; i++) { a[i] = a[i] / 2; }
    print(whole); print(fraction); print(adjust(-2.5)); print(native(-2.5));
    print(integer(-2.9)); print(a); print(1e-3); print(-0.0001);
    print(-1000000 - 1); print(1000000 + 1);
  `;
  for (const cssFunctions of [false, true]) assert.deepEqual(outputs(source, {}, { cssFunctions }), [-2, -.125, -.5, -1.25, -2, -.25, .625, .001, 0, -1000000, 1000000]);
  assert.match(valid('print(1.0);').html, /class="[^"\n]*number decimal"/);
  assert.deepEqual(outputs('print(sin(0)); print(cos(0)); print(tan(0)); print(atan2(1, 0));'), [0, 1, 0, 1.571]);
});

test("signed and fractional sliders preserve their range and temperature output", () => {
  const source = 'float x = input("x", -0.5, 10, -10); int y = input("y", -5, 10, -10); print(x); print(y);';
  assert.deepEqual(outputs(source), [-.5, -5]);
  assert.deepEqual(outputs(source, { x: -1.25, y: -3 }), [-1.25, -3]);
  const temperature = EXAMPLES.find(example => example.id === "temperature")!.source;
  for (const [value, expected] of [[-40, [-40, "ice"]], [0, [32, "liquid"]], [20.5, [68.9, "liquid"]], [100, [212, "steam"]]] as const) {
    assert.deepEqual(outputs(temperature, { "°C": value }), expected);
  }
});

test("strings survive reassignment, arrays, loop banks, and typed function calls", () => {
  const source = `
    int n = input("n", 1, 4);
    string identity(string text) { return text; }
    string choose(string fallback, int n) {
      string result = fallback;
      for (int i = 0; i < 3; i++) {
        if (i == n) { result = "hit"; break; }
      }
      return result;
    }
    string names[3] = {"zero", "one", "two"};
    string label = choose(names[n], n);
    print(label);
    names[n] = identity("changed");
    print(names);
    print("equal" == identity("equal"));
    print("a" != "b");
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, { n: 1 }, { cssFunctions }), ["hit", "zero", "changed", "two", 1, 1]);
    assert.deepEqual(outputs(source, { n: 4 }, { cssFunctions }), ["", "zero", "one", "two", 1, 1]);
  }
  const escaped = String.raw`string identity(string s) { return s; } string s = identity("</style><script>&\"\\"); print(s);`;
  assert.deepEqual(outputs(escaped), ['</style><script>&"\\']);
  assert.doesNotMatch(valid(escaped).html, /<script\b/i);
});

test("CSS clocks share periods, repeat in seconds, and work inside native functions", () => {
  const source = 'float clock() { return time(8); } float t = time(8); print(t); print(clock()); print(time());';
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, {}, { cssFunctions }, 9.25), [1.25, 1.25, 9.25]);
    const html = valid(source, { cssFunctions }).html;
    assert.equal((html.match(/@keyframes /g) ?? []).length, 2);
    assert.match(html, /id="pause-motion"/);
    assert.match(html, /prefers-reduced-motion: reduce/);
  }
  const unused = valid('float unused() { return time(7); } print(1);').html;
  assert.doesNotMatch(unused, /@keyframes |id="pause-motion"/);
});

test("drawing-only outputs retain live geometry and generate positioned HTML shapes", () => {
  const program = valid('float x = -2.5; float y = 3.25; float unused = 99; canvas(200, 150); rect(x, y, 20, 30, "#1234"); circle(x, y, 5); line(0, 0, x, y);');
  assert.equal(program.outputs, 3);
  assert.match(program.html, /class="scene-frame"[^>]+width: 200px; height: 150px/);
  assert.equal((program.html.match(/class="drawing-layer shape /g) ?? []).length, 3);
  assert.match(program.html, /\.shape-2::after \{[^}]+width: hypot\([^}]+rotate\(atan2/);
  assert.doesNotMatch(program.html, /--v2:|<script\b|<canvas\b|<svg\b/);
  assert.match(program.html, /width: max\(0px/);
});

test("drawing captures each execution step and reuses rules across loop iterations", () => {
  const source = (count: number) => `
    int x = 10;
    circle(x, 20, 2);
    for (int i = 0; i < ${count}; i++) {
      x = x + 10;
      circle(x, 20, 2);
    }
    x = 999;
    print(x);
  `;
  assert.deepEqual(evaluateProgram(source(4)).drawings.map(shape => shape.x), [10, 20, 30, 40, 50]);
  assert.deepEqual(outputs(source(4)), [999]);
  const small = valid(source(2)), large = valid(source(10));
  for (const pattern of [/\.s\d+ \{/g, /\.shape-\d+::after \{/g, /@property --v\d+ /g]) {
    assert.equal([...small.html.matchAll(pattern)].length, [...large.html.matchAll(pattern)].length);
  }
  assert.equal(large.outputs, 12);
});

test("drawing honors live branches, break, continue, and nested loops", () => {
  const source = `
    int n = input("n", 4, 6);
    for (int i = 0; i < 6; i++) {
      if (i == 1) { continue; }
      if (i >= n) { break; }
      for (int j = 0; j < 2; j++) {
        if (i % 2 == 0) { circle(i * 10, j * 20, 3); }
        else { rect(i * 10, j * 20, 4, 5); }
      }
    }
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(evaluateProgram(source, { n: 4 }, { cssFunctions }).drawings.map(({ kind, x, y }) => [kind, x, y]), [
      ["circle", 0, 0], ["circle", 0, 20], ["circle", 20, 0], ["circle", 20, 20], ["rect", 30, 0], ["rect", 30, 20],
    ]);
    assert.deepEqual(evaluateProgram(source, { n: 0 }, { cssFunctions }).drawings, []);
  }
});

test("drawing functions inherit caller visibility and stop drawing after return", () => {
  const source = `
    int n = input("n", 2, 4);
    int mark(int x) {
      if (x == 1) { return 0; }
      circle(x * 10, 25, 2);
      return x;
      circle(999, 999, 2);
    }
    int wrapper(int x) { return mark(x); }
    for (int i = 0; i < 4; i++) {
      if (i < n) { wrapper(i); }
    }
    print(wrapper(7));
  `;
  for (const cssFunctions of [false, true]) {
    const result = evaluateProgram(source, { n: 3 }, { cssFunctions });
    assert.deepEqual(result.drawings.map(shape => shape.x), [0, 20, 70]);
    assert.deepEqual(result.outputs, [7]);
    assert.doesNotMatch(valid(source, { cssFunctions }).html, /@function /);
  }
});

test("conditional expressions and boolean operators suppress unselected drawing calls", () => {
  const source = `
    int n = input("n", 0, 1);
    int mark(int x) { circle(x, 10, 2); return x; }
    string label(int x) { mark(x); return "marked"; }
    int a = n ? mark(10) : mark(20);
    int b = n && mark(30);
    int c = n || mark(40);
    print(n ? label(50) : label(60));
    print(n ? mark(70) : "none");
  `;
  for (const cssFunctions of [false, true]) {
    const zero = evaluateProgram(source, { n: 0 }, { cssFunctions });
    const one = evaluateProgram(source, { n: 1 }, { cssFunctions });
    assert.deepEqual(zero.drawings.map(shape => shape.x), [20, 40, 60]);
    assert.deepEqual(one.drawings.map(shape => shape.x), [10, 30, 50, 70]);
    assert.deepEqual(zero.outputs, ["marked", "none"]);
    assert.deepEqual(one.outputs, ["marked", 70]);
  }
});

test("validation of unused functions and empty loops does not emit drawings", () => {
  const source = `
    int unused() { circle(10, 20, 3); return 1; }
    for (int i = 0; i < 0; i++) { unused(); }
    print(7);
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(evaluateProgram(source, {}, { cssFunctions }), { outputs: [7], drawings: [] });
    assert.equal(valid(source, { cssFunctions }).outputs, 1);
    assert.doesNotMatch(valid(source, { cssFunctions }).html, /class="drawing-layer shape /);
  }
  assert.equal(compile('int unused() { circle("invalid", 0, 1); return 0; }').ok, false);
});

test("print snapshots values per iteration and shares CSS templates", () => {
  const source = (count: number) => `
    int x = 1;
    print(x);
    for (int i = 0; i < ${count}; i++) {
      x = x * 2;
      print(x);
    }
    x = 99;
    print(x);
  `;
  assert.deepEqual(outputs(source(4)), [1, 2, 4, 8, 16, 99]);
  const small = valid(source(2)), large = valid(source(10));
  assert.equal(small.html.match(/<style>([\s\S]*?)<\/style>/)![1], large.html.match(/<style>([\s\S]*?)<\/style>/)![1]);
  assert.equal(large.outputs, 12);
  const ids = [...large.html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("print supports branches, nested loops, break, and continue", () => {
  const source = `
    int n = input("n", 4, 6);
    for (int i = 0; i < 6; i++) {
      if (i >= n) { break; }
      if (i == 1) { continue; }
      for (int j = 0; j < 2; j++) {
        if (j == 0) { print(i); }
        else { print("next"); }
      }
    }
    print("end");
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, { n: 4 }, { cssFunctions }), [0, "next", 2, "next", 3, "next", "end"]);
    assert.deepEqual(outputs(source, { n: 0 }, { cssFunctions }), ["end"]);
  }
});

test("printing functions preserve call order, caller guards, and early returns", () => {
  const source = `
    int n = input("n", 1, 2);
    int show(int x) {
      print(x);
      if (x == 2) { return x; }
      print(-x);
      return x + 10;
      print("unreachable");
    }
    int wrapper(int x) { return show(x); }
    if (n) { print(wrapper(2)); } else { wrapper(3); }
    print(show(1) + show(4));
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, { n: 1 }, { cssFunctions }), [2, 2, 1, -1, 4, -4, 25]);
    assert.deepEqual(outputs(source, { n: 0 }, { cssFunctions }), [3, -3, 1, -1, 4, -4, 25]);
    assert.doesNotMatch(valid(source, { cssFunctions }).html, /@function /);
  }
});

test("prints respect conditional expressions and short-circuit operands", () => {
  const source = `
    int n = input("n", 0, 1);
    int show(int x) { print(x); return x; }
    string word(int x) { print(x); return "word"; }
    int a = n && show(10);
    int b = n || show(20);
    print(n ? show(30) : "none");
    print(n ? word(40) : word(50));
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, { n: 0 }, { cssFunctions }), [20, "none", 50, "word"]);
    assert.deepEqual(outputs(source, { n: 1 }, { cssFunctions }), [10, 30, 30, 40, "word"]);
  }
});

test("prints snapshot local arrays, fractions, and strings introduced later in a loop", () => {
  const source = `
    int show() {
      string words[2] = {"first", "second"};
      float numbers[2] = {-0.25, 1.5};
      for (int i = 0; i < 4; i++) {
        print(words);
        print(numbers);
        words[0] = "later";
        words[1] = "last";
        numbers[0] = numbers[0] + .5;
      }
      return 0;
    }
    show();
  `;
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, {}, { cssFunctions }), [
      "first", "second", -.25, 1.5, "later", "last", .25, 1.5,
      "later", "last", .75, 1.5, "later", "last", 1.25, 1.5,
    ]);
    assert.deepEqual(outputs('string s = ""; for (int i = 0; i < 4; i++) { print(s); s = "later"; }', {}, { cssFunctions }), ["", "later", "later", "later"]);
  }
});

test("unused printing functions and empty loops are validated without emitting rows", () => {
  const source = 'int unused() { print("ghost"); return 0; } for (int i = 0; i < 0; i++) { unused(); } print(7);';
  for (const cssFunctions of [false, true]) {
    assert.deepEqual(outputs(source, {}, { cssFunctions }), [7]);
    assert.equal(valid(source, { cssFunctions }).outputs, 1);
  }
  assert.equal(compile('int unused() { print(missing); return 0; }').ok, false);
  assert.equal(compile('if (false) { print(1 / 0); }').ok, false);
});

test("independent output stages fuse while preserving loop-bank snapshots", () => {
  const source = 'int x = 3; print(x); x = x + 2; circle(x, 10, 2); print(x); x = 99; print(x);';
  assert.deepEqual(outputs(source), [3, 5, 99]);
  assert.deepEqual(evaluateProgram(source).drawings.map(shape => shape.x), [5]);
  assert.equal((valid(source).html.match(/<div class="s\d+">/g) ?? []).length, 1);
  const loop = 'int n = 2; for (int i = 0; i < 4; i++) { print(n); n = n * 2; print(n); } print(n);';
  assert.deepEqual(outputs(loop), [2, 4, 4, 8, 8, 16, 16, 32, 32]);
  assert.equal((valid(loop).html.match(/<div class="s\d+">/g) ?? []).length, 5);
});

test("string dictionaries and mixed-choice queries are shared across print sites", () => {
  const source = String.raw`
    int n = input("n", 0, 1);
    string names[2] = {"", "</style><script>&\"\\"};
    for (int i = 0; i < 3; i++) {
      string s = names[n];
      print(s);
      print(n ? "text" : i);
    }
  `;
  const html = valid(source).html;
  assert.equal((html.match(/@counter-style text-table-/g) ?? []).length, 1);
  assert.equal((html.match(/@container printed style\(--choice:/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<script\b/i);
  assert.deepEqual(outputs(source, { n: 0 }), ["", 0, "", 1, "", 2]);
  const escaped = '</style><script>&"\\';
  assert.deepEqual(outputs(source, { n: 1 }), [escaped, "text", escaped, "text", escaped, "text"]);
  assert.doesNotMatch(html, /class="print-label"/);
});

test("typed values, clocks, and drawing report invalid arguments and contexts", () => {
  for (const source of [
    'string s = 1;', 'float x = "x";', 'string s = "x"; s = 1;',
    'string f() { return 1; }', 'float f() { return "x"; }',
    'string f(string s) { return s; } print(f(1));',
    'print("a" < "b");', 'print(true ? "a" : 1 + "b");',
    'string s = input("s");', 'int n = input("n", .5);',
    'float n = input("n", -1);', 'float n = input("n", 0, 0);',
    'float n = input("n", 0, -1, 1);', 'float n = 1e99;',
    'print(time(0));', 'print(time(-1));', 'print(time(3601));',
    'int n = 2; print(time(n));', 'print(time(1, 2));',
    'canvas(0, 100);', 'canvas(2001, 100);', 'canvas(10, 10); canvas(10, 10);',
    'circle(1, 2);', 'rect(0, 0, 2, 3, "red; color: red");',
    'line(0, 0, "x", 1);',
    'int f() { canvas(10, 10); return 1; }',
  ]) for (const cssFunctions of [false, true]) assert.equal(compile(source, { cssFunctions }).ok, false, source);
});
