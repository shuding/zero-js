import type { Drawing, DrawingColor, Execution, Input, PrintedValue, Runtime, StateRule, ValueNode } from "./compiler";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function cssString(value: string): string {
  return `"${value.replace(/["\\\x00-\x1f\x7f<>]/g, char => `\\${char.codePointAt(0)!.toString(16)} `)}"`;
}

function printedValues(prints: PrintedValue[]) {
  return prints.flatMap(printed => [
    ...printed.choices.flatMap(choice => "nodeId" in choice ? [choice.nodeId] : []),
    ...printed.selectorId === undefined ? [] : [printed.selectorId],
    ...printed.visible === undefined ? [] : [printed.visible],
  ]);
}

// A slider's thumb is its textarea's resize grip, which is as wide as the
// textarea's vertical scrollbar. Size both to the widest value badge (12px
// monospace, about 7.2px per character) so the whole badge drags.
function sliderThumb(node: ValueNode) {
  const { minimum, maximum } = node.input as Extract<Input, { kind: "slider" }>;
  const characters = Math.max(...[minimum, maximum].map(bound =>
    Number(bound < 0) + String(Math.floor(Math.abs(bound))).length + (node.type === "float" ? 4 : 0)));
  return Math.max(28, Math.ceil((characters * 7.5 + 14) / 2) * 2);
}

function drawingReads(drawing: Drawing) {
  return [
    ...drawing.values.filter(value => typeof value === "number"),
    ...drawing.visible === undefined ? [] : [drawing.visible],
    ...typeof drawing.color === "string" ? [] : [drawing.color.nodeId],
  ];
}

function drawingValues(program: Runtime) {
  return program.drawings.flatMap(drawingReads);
}

// Each palette entry takes 100% when the stored string ID matches, else 0%.
function paint(color: DrawingColor): string {
  if (typeof color === "string") return color;
  return color.palette.reduceRight((rest, choice) =>
    `color-mix(in srgb, ${choice.color} calc((1 - abs(sign(var(--v${color.nodeId}) - ${choice.value}px))) * 100%), ${rest})`, color.fallback);
}

// Move independent calculations onto one element. A write cannot cross an
// earlier read or output snapshot: CSS resolves all declarations together.
function fuseStages(program: Runtime, live: Set<number>) {
  const source = program.rules.map(rule => rule.assignments.filter(assignment => live.has(assignment.id)));
  const rules: StateRule[] = [];
  // Rules inside sibling iterations are evaluated once per iteration element.
  const repeated = new Set<number>();
  const optimize = (steps: Execution[], inEach = false): Execution[] => {
    const result: Execution[] = [];
    let current: StateRule | undefined;
    let writes = new Set<number>();
    let reads = new Set<number>();
    for (const step of steps) {
      if (step.kind === "repeat") {
        result.push({ ...step, odd: optimize(step.odd, inEach), even: optimize(step.even, inEach) });
        current = undefined;
      } else if (step.kind === "each") {
        result.push({ ...step, body: optimize(step.body, true) });
        current = undefined;
      } else if (step.kind === "step") {
        const assignments = source[step.rule];
        if (!assignments.length) continue;
        if (!current || assignments.some(assignment => writes.has(assignment.id) || reads.has(assignment.id))) {
          current = { id: rules.length, assignments: [] };
          rules.push(current);
          if (inEach) repeated.add(current.id);
          result.push({ kind: "step", rule: current.id });
          writes = new Set();
          reads = new Set();
        }
        current.assignments.push(...assignments);
        for (const assignment of assignments) {
          writes.add(assignment.id);
          for (const [, id] of assignment.width.matchAll(/var\(--v(\d+)\)/g)) reads.add(Number(id));
        }
      } else {
        result.push(step);
        const values = step.kind === "print" ? printedValues([program.prints[step.printed]])
          : drawingReads(program.drawings[step.drawing]);
        values.forEach(id => reads.add(id));
      }
    }
    return result;
  };
  return { execution: optimize(program.execution), rules, repeated };
}

// Liveness follows every possible write to a slot, including both loop banks.
// This is a graph walk rather than a linear SSA scan because slots are reused.
function liveValues(program: Runtime) {
  const dependencies = new Map<number, Set<number>>();
  for (const rule of program.rules) for (const assignment of rule.assignments) {
    const references = dependencies.get(assignment.id) ?? new Set<number>();
    for (const match of assignment.width.matchAll(/var\(--v(\d+)\)/g)) references.add(Number(match[1]));
    dependencies.set(assignment.id, references);
  }
  const live = new Set(program.nodes.filter(node => node.input).map(node => node.id));
  const pending = [...printedValues(program.prints), ...drawingValues(program)];
  while (pending.length) {
    const id = pending.pop()!;
    if (live.has(id)) continue;
    live.add(id);
    pending.push(...dependencies.get(id) ?? []);
  }
  return live;
}

// Values that cross elements need numeric snapshots. Local calculations can
// remain ordinary custom properties, provided substitution stays bounded.
function registeredValues(program: Runtime, rules: StateRule[], repeated = new Set<number>()) {
  const registered = new Set([
    ...program.nodes.filter(node => node.input).map(node => node.id),
    ...printedValues(program.prints),
    ...drawingValues(program),
  ]);
  for (const rule of rules) {
    const writes = new Set(rule.assignments.map(assignment => assignment.id));
    for (const assignment of rule.assignments) {
      for (const [, id] of assignment.width.matchAll(/var\(--v(\d+)\)/g)) {
        if (!writes.has(Number(id))) registered.add(Number(id));
      }
    }
  }

  // Count substituted characters without constructing the expanded strings.
  // Allow room for signed and fractional computed length serialization.
  const scalar = { length: 32, depth: 0 };
  for (const rule of rules) {
    // A rule evaluated on many sibling elements re-expands its substitutions on
    // each one, so it snapshots sooner: in a 32×24 Mandelbrot this cut render
    // time from 4.2s to 1.3s for 28 more registrations.
    const tooLarge = repeated.has(rule.id)
      ? (cost: typeof scalar) => cost.length > 2048 || cost.depth > 8
      : (cost: typeof scalar) => cost.length > 8192 || cost.depth > 16;
    const assignments = new Map(rule.assignments.map(assignment => [assignment.id, assignment.width]));
    const costs = new Map<number, typeof scalar>();
    const measure = (id: number): typeof scalar => {
      const cached = costs.get(id);
      if (cached) return cached;
      const width = assignments.get(id)!;
      const references = [...width.matchAll(/var\(--v(\d+)\)/g)].map(match => ({ id: Number(match[1]), length: match[0].length }));
      const expanded = () => {
        let length = width.length;
        let depth = 0;
        for (const reference of references) {
          const cost = registered.has(reference.id) ? scalar : measure(reference.id);
          length += cost.length - reference.length;
          depth = Math.max(depth, cost.depth + 1);
        }
        return { length, depth };
      };
      let cost = expanded();
      if (tooLarge(cost)) {
        // Snapshot operands before a large fan-out duplicates their expressions.
        for (const reference of references) registered.add(reference.id);
        cost = expanded();
        if (tooLarge(cost)) registered.add(id);
      }
      // Later registrations can only shrink these estimates.
      costs.set(id, cost);
      return cost;
    };
    for (const assignment of rule.assignments) measure(assignment.id);
  }
  return registered;
}

export function renderDocument(program: Runtime): string {
  const live = liveValues(program);
  const nodes = program.nodes.filter(node => live.has(node.id));
  const optimized = fuseStages(program, live);
  const stateRules = optimized.rules;
  const registered = registeredValues(program, stateRules, optimized.repeated);
  const { prints } = program;
  const inputs = nodes.filter(node => node.input);
  const pageInputs = inputs.filter(node => node.input!.global);
  const visibleInputs = inputs.filter(node => !node.input!.global);
  const sliders = inputs.filter(node => node.input!.kind === "slider");
  const holds = inputs.filter(node => node.input!.kind === "hold_time");
  const heldLabels = new Set(holds.filter(node => !node.input!.global).map(node => node.input!.label));
  const scrolls = new Map<string | undefined, { id: number; axes: Set<"x" | "y"> }>();
  for (const node of inputs) {
    const input = node.input!;
    if (input.kind !== "scroll") continue;
    const key = input.global ? undefined : input.label;
    let group = scrolls.get(key);
    if (!group) { group = { id: scrolls.size, axes: new Set() }; scrolls.set(key, group); }
    group.axes.add(input.axis);
  }
  const labelColumns = Math.min(18, Math.max(2, ...visibleInputs.map(node => node.input!.label.length)));
  // A thumb at its minimum overhangs the track start by half its width.
  const labelGap = Math.max(24, ...sliders.map(node => sliderThumb(node) / 2 + 6));
  const rules: string[] = [];
  const markup: string[] = ['<div class="computation">'];
  const controlValues: string[] = [];
  const animatedValues: string[] = [];
  const shownScrolls = new Set<string>();
  let top = visibleInputs.length ? 48 : 0;
  const pageScroll = scrolls.get(undefined);
  const pageToggle = pageInputs.some(node => node.input!.kind === "toggle");
  let pageMarkup = "";
  if (pageInputs.length) {
    const axes = pageScroll?.axes;
    const label = escapeHtml([
      pageToggle ? "Click or Space to toggle." : "Click to focus.",
      pageInputs.some(node => node.input!.kind === "pressed" || node.input!.kind === "hold_time") ? "Hold mouse or Space to press." : "",
      axes?.size ? "Arrow keys to move." : "",
    ].filter(Boolean).join(" "));
    pageMarkup = `<div class="page-controls"${pageScroll ? ` id="pad-${pageScroll.id}"` : ""}><div class="page-world">${pageToggle
      ? `<input id="page-input" class="page-input" type="checkbox" aria-label="${label}">`
      : `<button id="page-input" class="page-input" type="button" aria-label="${label}"></button>`}</div></div>`;
    rules.push(`.page-world { width: ${axes?.has("x") ? "calc(100% + 800px)" : "100%"}; height: ${axes?.has("y") ? "calc(100% + 800px)" : "100%"}; }`);
    if (pageScroll) {
      const timelines = [...pageScroll.axes].map(axis => `--pad-${pageScroll.id}-${axis} ${axis === "x" ? "inline" : "block"}`).join(", ");
      rules.push(`#pad-${pageScroll.id} { scroll-timeline: ${timelines}; overflow-x: ${pageScroll.axes.has("x") ? "scroll" : "hidden"}; overflow-y: ${pageScroll.axes.has("y") ? "scroll" : "hidden"}; }`);
    }
  }

  for (const node of nodes) {
    if (registered.has(node.id)) rules.push(`@property --v${node.id} { syntax: "<length>"; inherits: true; initial-value: 0px; }`);
  }
  if (visibleInputs.length) markup.push('<div class="section-heading" style="top: 0px">Input</div>');

  for (const node of inputs) {
    const input = node.input!;
    const label = escapeHtml(input.label);
    if (input.kind === "scroll") {
      const group = scrolls.get(input.global ? undefined : input.label)!;
      const value = `calc(var(--scroll-${group.id}-${input.axis}) * ${input.maximum} / 100)`;
      animatedValues.push(`--v${node.id}: clamp(0px, ${node.type === "float" ? value : `round(to-zero, ${value}, 1px)`}, ${input.maximum}px);`);
      if (input.global) continue;
      if (shownScrolls.has(input.label)) continue;
      shownScrolls.add(input.label);
      const timelines = [...group.axes].map(axis => `--pad-${group.id}-${axis} ${axis === "x" ? "inline" : "block"}`).join(", ");
      const held = heldLabels.has(input.label);
      rules.push(`#pad-${group.id} { scroll-timeline: ${timelines}; overflow-x: ${group.axes.has("x") ? "scroll" : "hidden"}; overflow-y: ${group.axes.has("y") ? "scroll" : "hidden"}; }`);
      rules.push(`#pad-${group.id} .scroll-world { width: ${group.axes.has("x") ? "calc(100% + 800px)" : "100%"}; height: ${group.axes.has("y") ? "calc(100% + 800px)" : "100%"}; }`);
      markup.push(`<span id="pad-label-${group.id}" class="input-label" style="top: ${top}px">${label}</span>`);
      markup.push(`<${held ? "button" : "div"} id="pad-${group.id}" class="control scroll-input" style="top: ${top}px" ${held ? 'type="button"' : 'tabindex="0" role="region"'} aria-labelledby="pad-label-${group.id}" aria-describedby="pad-help-${group.id}"><span class="scroll-world"></span></${held ? "button" : "div"}>`);
      markup.push(`<span id="pad-help-${group.id}" class="control-help" style="top: ${top + 86}px">${held ? "Focus · arrows + hold Space" : "Focus · arrow keys"}</span>`);
      top += 116;
      continue;
    }
    if (input.kind !== "slider") {
      if (input.global) {
        if (input.kind === "hold_time") {
          const value = `var(--held-${node.id})`;
          animatedValues.push(`--v${node.id}: ${node.type === "float" ? value : `round(to-zero, ${value}, 1px)`};`);
          rules.push(`body:has(#page-input:active) .computation { --hold-animation-${node.id}: hold-${node.id}; }`);
        } else {
          controlValues.push(`--v${node.id}: 0px;`);
          rules.push(`body:has(#page-input:${input.kind === "toggle" ? "checked" : "active"}) .computation { --v${node.id}: 1px; }`);
        }
        continue;
      }
      if (input.kind === "hold_time") {
        const value = `var(--held-${node.id})`;
        animatedValues.push(`--v${node.id}: ${node.type === "float" ? value : `round(to-zero, ${value}, 1px)`};`);
        const group = scrolls.get(input.label);
        rules.push(`.computation:has(#${group ? `pad-${group.id}` : `input-${node.id}`}:active) { --hold-animation-${node.id}: hold-${node.id}; }`);
        if (group) continue;
      } else {
        controlValues.push(`--v${node.id}: 0px;`);
        const state = input.kind === "toggle" ? "checked" : input.kind === "pressed" ? "active" : "valid";
        rules.push(`.computation:has(#input-${node.id}:${state}) { --v${node.id}: 1px; }`);
      }
      markup.push(`<label class="input-label" for="input-${node.id}" style="top: ${top}px">${label}</label>`);
      if (input.kind === "toggle") {
        markup.push(`<input id="input-${node.id}" class="control toggle-input" style="top: ${top}px" type="checkbox"${input.initial ? " checked" : ""}>`);
        top += 44;
      } else if (input.kind === "pressed" || input.kind === "hold_time") {
        markup.push(`<button id="input-${node.id}" class="control press-input" style="top: ${top}px" type="button" aria-describedby="help-${node.id}">Hold</button>`);
        markup.push(`<span id="help-${node.id}" class="control-help" style="top: ${top + 32}px">${input.kind === "hold_time" ? "Mouse or Space · release to reset" : "Mouse or Space"}</span>`);
        top += 64;
      } else {
        const letters = [...new Set([input.character.toLowerCase(), input.character.toUpperCase()])];
        const pattern = letters.map(letter => `\\u${letter.charCodeAt(0).toString(16).padStart(4, "0")}`).join("|");
        const characterLabel = escapeHtml(input.character === " " ? "Space" : input.character.toUpperCase());
        markup.push(`<input id="input-${node.id}" class="control typed-input" style="top: ${top}px" type="text" pattern="${pattern}" maxlength="1" required placeholder="${characterLabel}" autocomplete="off" spellcheck="false" aria-describedby="help-${node.id}">`);
        markup.push(`<span id="help-${node.id}" class="control-help" style="top: ${top + 32}px">Type ${characterLabel} · delete to reset</span>`);
        top += 64;
      }
      continue;
    }
    const { initial, maximum, minimum } = input;
    const scale = Math.max(1, Math.floor(200 / (maximum - minimum)));
    const trackWidth = (maximum - minimum) * scale;
    // The value sits at the thumb's center: half a thumb inside either end of the textarea.
    const thumb = sliderThumb(node);
    // Restore layout precision before flooring an input: 100cqw can otherwise
    // land just below an exact pixel (e.g. 29 becomes 28.999998).
    const measured = `calc((round(nearest, 100cqw, 0.015625px) - ${thumb}px) / var(--scale) + ${minimum}px)`;
    const value = `clamp(${minimum}px, ${node.type === "float" ? measured : `round(to-zero, ${measured}, 1px)`}, ${maximum}px)`;
    rules.push(`#input-${node.id} { anchor-name: --input-${node.id}; width: ${(initial - minimum) * scale + thumb}px; max-width: ${(maximum - minimum) * scale + thumb}px; top: ${top}px; --thumb: ${thumb}px; }`);
    rules.push(`#bridge-${node.id}, #read-${node.id} { width: anchor-size(--input-${node.id} width); --scale: ${scale}; --thumb: ${thumb}px; }`);
    rules.push(`#capture-${node.id} { --v${node.id}: ${value}; }`);
    rules.push(`#read-${node.id} { top: ${top + 12}px; --track-width: ${trackWidth}px; }`);
    rules.push(`#read-${node.id} .number { --result: ${value}; }`);
    markup.push(`<label class="input-label" for="input-${node.id}" style="top: ${top}px">${label}</label>`);
    markup.push(`<textarea id="input-${node.id}" class="input" readonly spellcheck="false" aria-label="${label}: drag to change value"></textarea>`);
    markup.push(`<div id="read-${node.id}" class="reader input-reader"><span class="number${node.type === "float" ? " decimal" : ""} slider-value"></span></div>`);
    // Keep each textarea and its bridge in the same positioning context.
    markup.push(`<div id="bridge-${node.id}" class="input-bridge"><div id="capture-${node.id}">`);
    top += 44;
  }
  if (controlValues.length) rules.push(`.computation { ${controlValues.join(" ")} }`);
  if (animatedValues.length) {
    // Read animated progress on a descendant, preserving integer truncation.
    markup.push('<div class="control-values">');
    rules.push(`.control-values { ${animatedValues.join(" ")} }`);
  }

  const activeRules = new Set<number>();
  for (const rule of stateRules) {
    activeRules.add(rule.id);
    rules.push(`.s${rule.id} {\n${rule.assignments.map(assignment => `  --v${assignment.id}: ${assignment.width};`).join("\n")}\n}`);
  }
  // Only emit native helpers reachable from a live state rule.
  const usedFunctions = new Set<string>();
  const pendingFunctions = [...rules.join("\n").matchAll(/(--fn\d+)\(/g)].map(match => match[1]);
  while (pendingFunctions.length) {
    const name = pendingFunctions.pop()!;
    if (usedFunctions.has(name)) continue;
    usedFunctions.add(name);
    const fn = program.functions.find(fn => fn.name === name)!;
    pendingFunctions.push(...[...fn.declarations.join("\n").matchAll(/(--fn\d+)\(/g)].map(match => match[1]));
  }
  for (const fn of program.functions) {
    if (!usedFunctions.has(fn.name)) continue;
    rules.push(`@function ${fn.name}(${fn.parameters.map(param => `${param} <length>`).join(", ")}) returns <length> {\n${fn.declarations.join("\n")}\n  result: ${fn.result};\n}`);
  }
  const usedClocks = new Set([...rules.join("\n").matchAll(/var\(--clock-(\d+)\)/g)].map(match => Number(match[1])));
  const clocks = program.clocks.filter(clock => usedClocks.has(clock.id));
  for (const clock of clocks) {
    rules.push(`@property --clock-${clock.id} { syntax: "<length>"; inherits: true; initial-value: 0px; }`);
    rules.push(`@keyframes clock-${clock.id} { from { --clock-${clock.id}: 0px; } to { --clock-${clock.id}: ${clock.period}px; } }`);
  }
  const animations = clocks.map(clock => `clock-${clock.id} ${clock.period}s linear infinite`);
  const timelines = clocks.map(() => "auto");
  const playStates = clocks.map(() => "var(--clock-play, running)");
  for (const node of holds) {
    if (node.input!.kind !== "hold_time") continue;
    rules.push(`@property --held-${node.id} { syntax: "<length>"; inherits: true; initial-value: 0px; }`);
    rules.push(`@keyframes hold-${node.id} { from { --held-${node.id}: 0px; } to { --held-${node.id}: ${node.input!.duration}px; } }`);
    animations.push(`var(--hold-animation-${node.id}, none) ${node.input!.duration}s linear forwards`);
    timelines.push("auto");
    playStates.push("var(--clock-play, running)");
  }
  if (animations.length) rules.push(`.computation { animation: ${animations.join(", ")}; animation-play-state: ${playStates.join(", ")}; }`);
  const scrollSupport = "((animation-timeline: --scroll-test) and (timeline-scope: --scroll-test))";
  for (const group of scrolls.values()) for (const axis of group.axes) {
    const name = `scroll-${group.id}-${axis}`;
    rules.push(`@property --${name} { syntax: "<length>"; inherits: true; initial-value: 0px; }`);
    rules.push(`@keyframes ${name} { from { --${name}: 0px; } to { --${name}: 100px; } }`);
    animations.push(`${name} 1s linear both`);
    timelines.push(`--pad-${group.id}-${axis}`);
    playStates.push("running");
  }
  if (scrolls.size) {
    rules.push(`${pageScroll ? "body" : ".program"} { timeline-scope: ${timelines.filter(name => name !== "auto").join(", ")}; }`);
    rules.push(`@supports ${scrollSupport} { .computation { animation: ${animations.join(", ")}; animation-timeline: ${timelines.join(", ")}; animation-play-state: ${playStates.join(", ")}; } }`);
    rules.push(`@supports not ${scrollSupport} { .scroll-unsupported { display: block; } .program, .page-controls { display: none; } }`);
  }
  // Counter styles decode string IDs with one shared dictionary instead of a
  // span and a style query for every possible string at every print site.
  const textTables = new Map<string, string>();
  const choiceQueries = new Set<number>();
  // Conditional rows query their parent step, which holds the visibility slot,
  // so a print needs no wrapper element. Rows sharing a slot share a rule.
  const visibleRows = new Map<number, string[]>();
  const printedMarkup = prints.map((printed, index) => {
    const selected = printed.selectorId !== undefined;
    const single = !selected && printed.choices.length === 1 ? printed.choices[0] : undefined;
    const numeric = single && "nodeId" in single ? single : undefined;
    const value = selected ? `--choice: var(--v${printed.selectorId}); ` : numeric ? `--result: var(--v${numeric.nodeId}); ` : "";
    if (value) rules.push(`.print-${index} { ${value}}`);
    const classes = ["print", "print-row", `print-${index}`];
    if (printed.visible !== undefined) {
      classes.push("conditional");
      visibleRows.set(printed.visible, [...visibleRows.get(printed.visible) ?? [], `.print-${index}.conditional`]);
    }
    if (printed.error) classes.push("runtime-error");
    // A single value renders on the output itself: numbers and string tables
    // in ::after, literal text as the row's second grid item.
    let choices = "";
    if (selected && printed.choices.every(choice => "text" in choice)) {
      const texts = printed.choices.map(choice => choice.text);
      const key = JSON.stringify(texts);
      let table = textTables.get(key);
      if (!table) {
        table = `text-table-${textTables.size}`;
        textTables.set(key, table);
        rules.push(`@counter-style ${table} { system: fixed 0; symbols: ${texts.map(cssString).join(" ")}; suffix: ""; }`);
        rules.push(`.${table}::after { counter-reset: text-value calc(var(--choice) / 1px); content: counter(text-value, ${table}); }`);
      }
      classes.push(table);
    } else if (numeric) {
      classes.push("value", ...program.nodes[numeric.nodeId].type === "float" ? ["decimal"] : []);
    } else if (single && "text" in single && !printed.error) {
      classes.push("literal");
      choices = escapeHtml(single.text);
    } else choices = printed.choices.map((choice, choiceIndex) => {
      const name = `print-${index}-choice-${choiceIndex}`;
      if (selected) {
        choiceQueries.add(choiceIndex);
        if ("nodeId" in choice) rules.push(`.${name} { --result: var(--v${choice.nodeId}); }`);
      }
      return `<span class="${name} ${"text" in choice ? "text" : `number${program.nodes[choice.nodeId].type === "float" ? " decimal" : ""}`}${selected ? ` choice choice-${choiceIndex}` : ""}">${"text" in choice ? escapeHtml(choice.text) : ""}</span>`;
    }).join("");
    return `<output class="${classes.join(" ")}" data-label="${escapeHtml(printed.label)}"${printed.error ? ' role="alert"' : ""}>${choices}</output>`;
  });
  for (const index of choiceQueries) rules.push(`@container printed style(--choice: ${index}px) { .choice-${index} { display: block; } }`);
  for (const [id, rows] of visibleRows) rules.push(`@container style(--v${id}: 1px) { ${rows.join(", ")} { display: grid; } }`);
  const execution: string[] = [];
  // Returns how many step elements remain open for the caller to close.
  const emit = (steps: Execution[]): number => {
    let open = 0;
    for (const step of steps) {
      if (step.kind === "step") {
        if (activeRules.has(step.rule)) {
          execution.push(`<div class="s${step.rule}">`);
          open++;
        }
      } else if (step.kind === "print") {
        execution.push(printedMarkup[step.printed]);
      } else if (step.kind === "draw") {
        const drawing = program.drawings[step.drawing];
        execution.push(`<div class="drawing-layer shape ${drawing.kind} shape-${step.drawing}"></div>`);
      } else if (step.kind === "each") {
        // Independent iterations are siblings that close their own steps.
        for (const value of step.values) {
          execution.push(`<div style="--v${step.counter}: ${value}px">`);
          execution.push("</div>".repeat(emit(step.body) + 1));
        }
      } else {
        for (let index = 0; index < step.count; index++) open += emit(index % 2 ? step.even : step.odd);
      }
    }
    return open;
  };
  const openSteps = emit(optimized.execution);
  const heading = prints.length || program.drawings.length
    ? '<div class="section-heading" style="top: 12px">Output</div>'
    : '<p class="empty" style="top: 16px">Use print(expression) to display a result.</p>';
  let scene = "";
  if (program.drawings.length) {
    program.drawings.forEach((drawing, index) => {
      const [a, b, c, d] = drawing.values.map(value => typeof value === "number" ? `var(--v${value})` : value);
      let geometry: string;
      if (drawing.kind === "rect") geometry = `left: ${a}; top: ${b}; width: max(0px, ${c}); height: max(0px, ${d});`;
      else if (drawing.kind === "circle") geometry = `left: ${a}; top: ${b}; width: max(0px, calc(${c} * 2)); height: max(0px, calc(${c} * 2)); transform: translate(-50%, -50%); border-radius: 50%;`;
      else geometry = `left: ${a}; top: ${b}; width: hypot(calc(${c} - ${a}), calc(${d} - ${b})); height: 2px; transform-origin: 0 50%; transform: translateY(-50%) rotate(atan2(calc(${d} - ${b}), calc(${c} - ${a})));`;
      rules.push(`.shape-${index}::after { ${geometry} background: ${paint(drawing.color)};${drawing.visible === undefined ? "" : ` opacity: calc(var(--v${drawing.visible}) / 1px);`} }`);
    });
    scene = `<div class="scene-frame" role="img" aria-label="Program drawing" style="width: ${program.canvas.width}px; height: ${program.canvas.height}px"></div>`;
  }
  // Normal flow stacks only visible rows. The canvas follows the rows, and
  // drawing layers anchor to it while retaining their earlier state snapshots.
  markup.push(`<div class="output-space"><div class="output-content">${heading}<div class="execution">${execution.join("")}${scene}${"</div>".repeat(openSteps)}</div></div></div>${animatedValues.length ? "</div>" : ""}${"</div></div>".repeat(sliders.length)}</div>`);

  // Emit template rules only for the features this program uses.
  const when = (condition: boolean, css: string) => condition ? css : "";
  const hasSliders = sliders.length > 0;
  const printsNumber = (float: boolean) => prints.some(printed => printed.choices.some(choice => "nodeId" in choice && (!float || program.nodes[choice.nodeId].type === "float")));
  const hasNumbers = hasSliders || printsNumber(false);
  const hasDecimals = sliders.some(node => node.type === "float") || printsNumber(true);
  const hasDrawings = program.drawings.length > 0;
  const hasMotion = clocks.length > 0 || holds.length > 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'">
<title>zero-js output</title>
<style>
:root { color-scheme: light; font: 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #000000; background: #ffffff; }
::selection { background: #0066ff33; }
@property --program-width { syntax: "<length>"; inherits: true; initial-value: 0px; }
${when(hasNumbers, '@property --result { syntax: "<length>"; inherits: true; initial-value: 0px; }')}
${when(hasDecimals, `@counter-style decimal-three { system: numeric; symbols: "0" "1" "2" "3" "4" "5" "6" "7" "8" "9"; pad: 3 "0"; }
@counter-style decimal-sign { system: fixed 0; symbols: "" "-"; }`)}
${prints.some(printed => printed.selectorId !== undefined) ? '@property --choice { syntax: "<length>"; inherits: true; initial-value: 0px; }' : ""}
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 24px; }
.program { position: relative; min-height: ${top + 64}px; container-type: inline-size; }
${when(visibleInputs.length > 0, `.input-label { position: absolute; left: 0; max-width: calc(var(--slider-left) - ${labelGap}px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 24px; }`)}
.computation { --program-width: 100cqw; --slider-left: calc(${labelColumns}ch + ${labelGap}px); position: absolute; left: 0; top: 0; width: 100%; font-size: 13px; }
${pageInputs.length ? `.page-controls { position: fixed; inset: 0; z-index: 2; overflow: hidden; opacity: 0; scrollbar-width: none; overscroll-behavior: contain; }
.page-controls::-webkit-scrollbar { display: none; }
.page-input { position: sticky; left: 0; top: 0; display: block; width: 100vw; height: 100dvh; margin: 0; padding: 0; border: 0; appearance: none; }
.program { z-index: 3; pointer-events: none; }
.input, .control, .input-label, .motion-control { pointer-events: auto; }
body:has(#page-input:focus-visible) .scene-frame { outline: 2px solid #0066ff; outline-offset: 3px; }` : ""}
${when(hasSliders, `.input-bridge { position: absolute; left: 0; top: 0; container-type: inline-size; }`)}
.output-space { position: absolute; left: 0; top: ${top}px; width: var(--program-width); overflow-x: auto; }
.output-content { position: relative; min-width: ${program.drawings.length ? program.canvas.width + 2 : 0}px; padding-bottom: 16px; }
.execution { padding-top: 48px; }
${when(hasSliders, `.input-reader::before, .input-reader::after { content: ""; position: absolute; left: calc(var(--thumb) / 2); top: -1px; height: 2px; border-radius: 2px; }
.input-reader::before { width: var(--track-width); background: #e5e5e5; }
.input-reader::after { width: max(0px, calc(100% - var(--thumb))); background: #0066ff; }
.input { position: absolute; left: calc(var(--slider-left) - var(--thumb) / 2); height: 24px; min-width: var(--thumb); padding: 0; border: 0; margin: 0; font: inherit; resize: horizontal; overflow: hidden scroll; opacity: 0; cursor: ew-resize; }
/* The resize grip takes the scrollbar's width, so it covers the whole badge. */
.input::-webkit-scrollbar { width: var(--thumb); background: transparent; }
.input:focus-visible + .input-reader .slider-value { outline: 2px solid #0066ff; outline-offset: 3px; }`)}
${inputs.some(node => node.input!.kind !== "slider") ? `.control { position: absolute; left: var(--slider-left); margin: 0; font: inherit; color: inherit; }
.control:focus-visible { outline: 2px solid #0066ff; outline-offset: 3px; }
.control-help { position: absolute; left: var(--slider-left); font-size: 11px; line-height: 18px; color: #666666; }
.toggle-input { width: 28px; height: 24px; accent-color: #0066ff; cursor: pointer; }
.press-input, .typed-input { height: 28px; padding: 3px 10px; background: #ffffff; border: 1px solid #d4d4d4; border-radius: 2px; }
.press-input { cursor: pointer; }
.press-input:active { background: #0066ff; color: #ffffff; border-color: #0066ff; }
.typed-input { width: 52px; }
.typed-input:valid { border-color: #0066ff; background: #e8f0ff; }
.scroll-input { width: min(200px, calc(var(--program-width) - var(--slider-left))); height: 80px; padding: 0; border: 1px solid #d4d4d4; border-radius: 2px; background: transparent; overscroll-behavior: contain; }
.scroll-world { display: block; background: repeating-linear-gradient(0deg, transparent 0 19px, #eeeeee 19px 20px), repeating-linear-gradient(90deg, transparent 0 19px, #eeeeee 19px 20px); }` : ""}
${when(hasSliders, `.reader { position: absolute; left: 0; padding: 0; border: 0; margin: 0; height: 24px; container-type: inline-size; pointer-events: none; }`)}
${when(hasNumbers, `.number { position: absolute; left: 0; width: max-content; font-variant-numeric: tabular-nums; }
/* Output reads stored values directly, without a round-trip through cqw. */
.number::after, .value::after { counter-reset: value calc(var(--result) / 1px); content: counter(value); font-variant-numeric: tabular-nums; }`)}
${when(hasDecimals, `.number.decimal::after, .value.decimal::after { --scaled: round(nearest, calc(abs(var(--result)) / 1px * 1000), 1); counter-reset: negative calc(max(0, -1 * sign(var(--result))) * sign(var(--scaled))) whole round(down, calc(var(--scaled) / 1000), 1) fraction mod(var(--scaled), 1000); content: counter(negative, decimal-sign) counter(whole) "." counter(fraction, decimal-three); }`)}
${when(hasSliders, `.input-reader { left: calc(var(--slider-left) - var(--thumb) / 2); }
.slider-value { left: calc(100% - var(--thumb) / 2); top: 0; z-index: 1; width: var(--thumb); padding: 3px 0; border-radius: 2px; background: #0066ff; color: #ffffff; transform: translate(-50%, -50%); font-size: 12px; line-height: 18px; text-align: center; }`)}
.section-heading { position: absolute; left: 0; right: 0; border-top: 1px dashed #e5e5e5; padding-top: 12px; font-size: 11px; letter-spacing: .08em; text-transform: lowercase; color: #666666; }
${when(prints.length > 0, `.print-row { display: grid; grid-template-columns: 60% 40%; min-height: 44px; width: var(--program-width); }
.print::before { content: attr(data-label); grid-column: 1; grid-row: 1; min-width: 0; padding-top: 3px; padding-right: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #666666; }
.print { position: relative; min-width: 0; container-name: printed; }
/* A single value is the row's second grid item: ::after, or literal text. */
.print::after, .print .number, .print .text { grid-column: 2; grid-row: 1; }
.print::after, .print.literal, .print .number, .print .text { font-size: 22px; color: #000000; }
.print::after, .print.literal, .print .text { white-space: pre; }
.print .number, .print .text { position: static; }`)}
${when(visibleRows.size > 0, '.print-row.conditional { display: none; }')}
${prints.some(printed => printed.error) ? '.runtime-error { grid-template-columns: 1fr; gap: 6px; padding: 10px 0; color: #d92d20; }\n.runtime-error .text { grid-column: 1; grid-row: 2; white-space: normal; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }' : ""}
${when(choiceQueries.size > 0, '.choice { display: none; }')}
${when(hasDrawings, `.scene-frame { anchor-name: --scene; position: relative; box-sizing: content-box; border: 1px solid #e5e5e5; border-radius: 2px; background: #ffffff; }
.drawing-layer { position: absolute; position-anchor: --scene; left: calc(anchor(left) + 1px); top: calc(anchor(top) + 1px); z-index: 1; width: ${program.canvas.width}px; height: ${program.canvas.height}px; overflow: hidden; border-radius: 3px; pointer-events: none; }
.drawing-layer::after { content: ""; position: absolute; }`)}
${when(hasMotion, `.motion-control { position: absolute; right: 0; top: 13px; z-index: 1; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #666666; }
.motion-control input { accent-color: #0066ff; margin: 0; }
.program:has(#pause-motion:checked) { --clock-play: paused; }
@media (prefers-reduced-motion: reduce) { .program { --clock-play: paused; } }`)}
${when(!prints.length && !hasDrawings, '.empty { position: absolute; margin: 0; color: #666666; font-size: 12px; }')}
.unsupported, .scroll-unsupported { display: none; font-size: 12px; }
@supports not ((width: anchor-size(--test width)) and (counter-reset: value calc(1px / 1px)) and (width: round(down, 1px, 1px)) and (width: abs(-1px)) and (width: calc(sign(1px) * 1px))) {
  .unsupported { display: block; }
  .program, .page-controls { display: none; }
}
@media (max-width: 360px) { body { padding: 24px 12px; } }
${rules.join("\n")}
</style>
</head>
<body>
${pageMarkup}
<p class="unsupported">Requires a browser with CSS anchor sizing and typed arithmetic.</p>
${scrolls.size ? '<p class="scroll-unsupported">Arrow-key inputs require a browser with CSS scroll timelines and timeline-scope support.</p>' : ""}
<main class="program" aria-label="Program inputs and outputs">
${clocks.length || holds.length ? '<label class="motion-control"><input id="pause-motion" type="checkbox">Pause</label>' : ""}
${markup.join("\n")}
</main>
</body>
</html>`;
}
