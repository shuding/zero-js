import { renderDocument } from "./runtime";

export type Diagnostic = { message: string; line: number; column: number; offset: number };
export type ValueType = "int" | "float" | "string";
export type Input = (
  | { kind: "slider"; label: string; initial: number; maximum: number; minimum: number }
  | { kind: "toggle"; label: string; initial: boolean }
  | { kind: "pressed"; label: string }
  | { kind: "hold_time"; label: string; duration: number }
  | { kind: "typed"; label: string; character: string }
  | { kind: "scroll"; label: string; axis: "x" | "y"; maximum: number }
) & { global?: true };
export type ValueNode = { id: number; name: string; width: string; type: ValueType; input?: Input };
export type PrintChoice = { text: string } | { nodeId: number };
export type PrintedValue = { label: string; choices: PrintChoice[]; selectorId?: number; visible?: number; error?: boolean };
export type CompilerOptions = { cssFunctions?: boolean; recursionSteps?: number };
export type Assignment = { id: number; width: string };
export type StateRule = { id: number; assignments: Assignment[] };
export type Execution = { kind: "step"; rule: number } | { kind: "print"; printed: number } | { kind: "draw"; drawing: number } | { kind: "repeat"; count: number; odd: Execution[]; even: Execution[] };
export type NativeFunction = { name: string; parameters: string[]; declarations: string[]; result: string };
export type Drawing = { kind: "rect" | "circle" | "line"; values: number[]; visible: number; color: string };
export type Clock = { id: number; period: number };
export type Runtime = { nodes: ValueNode[]; rules: StateRule[]; execution: Execution[]; prints: PrintedValue[]; functions: NativeFunction[]; drawings: Drawing[]; clocks: Clock[]; canvas: { width: number; height: number } };
export type Program = { html: string; variables: number; inputs: number; outputs: number; cssFunctions: boolean };
export type Compilation = { ok: true; program: Program } | { ok: false; error: Diagnostic };

type Token = { kind: "name" | "number" | "string" | "symbol" | "end"; value: string; offset: number };
type Expression =
  | { kind: "number"; value: number; token: Token }
  | { kind: "string"; value: string; token: Token }
  | { kind: "reference"; name: string; token: Token }
  | { kind: "index"; name: string; index: Expression; token: Token }
  | { kind: "unary"; operator: string; operand: Expression; token: Token }
  | { kind: "binary"; operator: string; left: Expression; right: Expression; token: Token }
  | { kind: "conditional"; condition: Expression; yes: Expression; no: Expression; token: Token }
  | { kind: "call"; name: string; args: Expression[]; token: Token }
  | { kind: "input"; input: Input; token: Token };
type Statement =
  | { kind: "declare"; name: Token; type: ValueType; expression: Expression }
  | { kind: "array"; name: Token; type: ValueType; size: number; values: Expression[] }
  | { kind: "assign"; name: Token; index?: Expression; expression: Expression }
  | { kind: "print"; expression: Expression; label: string; token: Token }
  | { kind: "if"; condition: Expression; yes: Statement[]; no: Statement[]; token: Token }
  | { kind: "for"; name: Token; start: number; end: number; step: number; body: Statement[]; token: Token; tail?: boolean }
  | { kind: "function"; name: Token; type: ValueType; params: { name: Token; type: ValueType }[]; body: Statement[] }
  | { kind: "draw"; shape: Drawing["kind"]; args: Expression[]; token: Token }
  | { kind: "call"; expression: Expression; token: Token }
  | { kind: "canvas"; width: number; height: number; token: Token }
  | { kind: "return"; expression: Expression; token: Token }
  | { kind: "break"; token: Token }
  | { kind: "continue"; token: Token };
type FunctionDefinition = Extract<Statement, { kind: "function" }>;

const MAX_VALUE = 1_000_000;
const MAX_SOURCE = 20_000;
const MAX_DEPTH = 48;
const MAX_STATEMENTS = 128;
const MAX_ITERATIONS = 128;
const MAX_ARRAY_LENGTH = 32;
const MAX_NODES = 6_000;
const MAX_EXPANSION = 30_000;
const TYPES = new Set(["int", "float", "string"]);
const INPUT_FUNCTIONS = new Set(["input", "click", "press", "arrow_x", "arrow_y", "toggle", "pressed", "hold_time", "typed", "scroll_x", "scroll_y"]);
const DRAWING_ARITY = new Map<string, number>([["rect", 4], ["circle", 3], ["line", 4]]);
const FUNCTION_ARITY = new Map([
  ["min", 2], ["max", 2], ["clamp", 3], ["abs", 1], ["sign", 1],
  ["floor", 1], ["ceil", 1], ["round", 1], ["sqrt", 1],
  ["hypot", 2], ["mod", 2], ["rem", 2],
  ["sin", 1], ["cos", 1], ["tan", 1], ["atan2", 2], ["time", -1],
]);
const PRECEDENCE = new Map([
  ["||", 1], ["&&", 2],
  ["==", 3], ["!=", 3], ["<", 4], [">", 4], ["<=", 4], [">=", 4],
  ["+", 5], ["-", 5], ["*", 6], ["/", 6], ["%", 6],
]);
const RESERVED = new Set([...TYPES, "if", "else", "for", "return", "break", "continue", "print", "canvas", "true", "false", "and", "or", "not", ...INPUT_FUNCTIONS, ...FUNCTION_ARITY.keys(), ...DRAWING_ARITY.keys()]);

class CompileError extends Error {
  constructor(message: string, readonly offset: number) { super(message); }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char)) { offset++; continue; }
    if (source.startsWith("//", offset)) {
      const end = source.indexOf("\n", offset);
      offset = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      if (end < 0) throw new CompileError("Close this comment with */.", offset);
      offset = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const start = offset++;
      let value = "";
      while (offset < source.length && source[offset] !== char) {
        if (source[offset] === "\n") throw new CompileError("Strings must stay on one line.", offset);
        if (source[offset] === "\\") {
          offset++;
          const escaped = source[offset];
          if (escaped !== char && escaped !== "\\") {
            throw new CompileError("Only quotes and backslashes can be escaped in a string.", offset);
          }
        }
        value += source[offset++];
      }
      if (offset === source.length) throw new CompileError("Close this string with a matching quote.", start);
      offset++;
      tokens.push({ kind: "string", value, offset: start });
      continue;
    }
    const name = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(source.slice(offset));
    if (name) {
      tokens.push({ kind: "name", value: name[0], offset });
      offset += name[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (number) {
      tokens.push({ kind: "number", value: number[0], offset });
      offset += number[0].length;
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "++"].includes(pair)) {
      tokens.push({ kind: "symbol", value: pair, offset });
      offset += 2;
      continue;
    }
    if ("=;(),+-*/%<>!?:{}[]".includes(char)) {
      tokens.push({ kind: "symbol", value: char, offset: offset++ });
      continue;
    }
    throw new CompileError(`Unexpected character ${JSON.stringify(char)}.`, offset);
  }
  tokens.push({ kind: "end", value: "", offset: source.length });
  return tokens;
}

class Parser {
  private cursor = 0;
  private statementCount = 0;
  constructor(private tokens: Token[], private source: string) {}
  private get current() { return this.tokens[this.cursor]; }
  private take() { const token = this.current; if (token.kind !== "end") this.cursor++; return token; }
  private matches(value: string) { return this.current.kind !== "string" && this.current.value === value; }
  private expect(value: string) {
    if (!this.matches(value)) throw new CompileError(`Expected ${JSON.stringify(value)}.`, this.current.offset);
    return this.take();
  }
  private integer() {
    const token = this.take();
    const value = Number(token.value);
    if (token.kind !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_VALUE) {
      throw new CompileError(`Use a whole number between 0 and ${MAX_VALUE.toLocaleString("en-US")}.`, token.offset);
    }
    return value;
  }
  private number(signed = false) {
    let sign = 1;
    if (signed && (this.matches("-") || this.matches("+"))) sign = this.take().value === "-" ? -1 : 1;
    const token = this.take();
    const value = Number(token.value) * sign;
    if (token.kind !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_VALUE) throw new CompileError(`Use a number between -${MAX_VALUE} and ${MAX_VALUE}.`, token.offset);
    return value;
  }
  private type(): ValueType {
    const token = this.take();
    if (!TYPES.has(token.value)) throw new CompileError("Expected int, float, or string.", token.offset);
    return token.value as ValueType;
  }
  private name() {
    const name = this.take();
    if (name.kind !== "name" || RESERVED.has(name.value)) throw new CompileError("Expected a variable or function name, such as total.", name.offset);
    return name;
  }
  parse(): Statement[] {
    const statements: Statement[] = [];
    while (this.current.kind !== "end") statements.push(this.statement(0));
    return statements;
  }
  private block(depth: number): Statement[] {
    this.expect("{");
    const statements: Statement[] = [];
    while (!this.matches("}")) {
      if (this.current.kind === "end") throw new CompileError('Expected "}" to close this block.', this.current.offset);
      statements.push(this.statement(depth + 1));
    }
    this.expect("}");
    return statements;
  }
  private statement(depth: number): Statement {
    if (depth > MAX_DEPTH) throw new CompileError("These blocks are too deeply nested.", this.current.offset);
    if (++this.statementCount > MAX_STATEMENTS) throw new CompileError(`Keep programs to ${MAX_STATEMENTS} statements or fewer.`, this.current.offset);
    const token = this.take();
    if (token.kind !== "name") throw new CompileError("Expected a statement.", token.offset);
    if (TYPES.has(token.value)) {
      const type = token.value as ValueType;
      const name = this.name();
      if (this.matches("(")) {
        if (depth !== 0) throw new CompileError("Declare functions at the top level.", name.offset);
        this.take();
        const params: { name: Token; type: ValueType }[] = [];
        if (!this.matches(")")) {
          do {
            if (params.length) this.expect(",");
            const type = this.type();
            params.push({ name: this.name(), type });
          } while (this.matches(","));
        }
        this.expect(")");
        return { kind: "function", name, type, params, body: this.block(depth) };
      }
      if (this.matches("[")) {
        this.take();
        const size = this.integer();
        if (size < 1 || size > MAX_ARRAY_LENGTH) throw new CompileError(`Array sizes must be between 1 and ${MAX_ARRAY_LENGTH}.`, name.offset);
        this.expect("]");
        const values: Expression[] = [];
        if (this.matches("=")) {
          this.take();
          this.expect("{");
          while (!this.matches("}")) {
            if (values.length === size) throw new CompileError(`This array has room for ${size} initial values.`, this.current.offset);
            values.push(this.expression());
            if (!this.matches(",")) break;
            this.take();
          }
          this.expect("}");
        }
        this.expect(";");
        return { kind: "array", name, type, size, values };
      }
      this.expect("=");
      const expression = this.expression();
      this.expect(";");
      return { kind: "declare", name, type, expression };
    }
    if (token.value === "canvas") {
      this.expect("(");
      const width = this.integer();
      this.expect(",");
      const height = this.integer();
      if (width < 1 || height < 1 || width > 2000 || height > 2000) throw new CompileError("Canvas dimensions must be between 1 and 2000 pixels.", token.offset);
      this.expect(")");
      this.expect(";");
      return { kind: "canvas", width, height, token };
    }
    if (DRAWING_ARITY.has(token.value)) {
      this.expect("(");
      const args: Expression[] = [];
      if (!this.matches(")")) {
        args.push(this.expression());
        while (this.matches(",")) { this.take(); args.push(this.expression()); }
      }
      this.expect(")");
      this.expect(";");
      const arity = DRAWING_ARITY.get(token.value)!;
      if (args.length !== arity && args.length !== arity + 1) throw new CompileError(`${token.value} takes ${arity} coordinates and an optional hex color.`, token.offset);
      return { kind: "draw", shape: token.value as Drawing["kind"], args, token };
    }
    if (token.value === "if") {
      this.expect("(");
      const condition = this.expression();
      this.expect(")");
      const yes = this.block(depth);
      let no: Statement[] = [];
      if (this.matches("else")) {
        this.take();
        no = this.matches("if") ? [this.statement(depth + 1)] : this.block(depth);
      }
      return { kind: "if", condition, yes, no, token };
    }
    if (token.value === "for") {
      // Literal bounds keep the layout graph finite; the body remains reactive.
      this.expect("(");
      this.expect("int");
      const name = this.name();
      this.expect("=");
      const start = this.integer();
      this.expect(";");
      this.expect(name.value);
      const inclusive = this.matches("<=");
      this.expect(inclusive ? "<=" : "<");
      const end = this.integer() + (inclusive ? 1 : 0);
      this.expect(";");
      this.expect(name.value);
      let step = 1;
      if (this.matches("++")) this.take();
      else {
        this.expect("=");
        this.expect(name.value);
        this.expect("+");
        step = this.integer();
      }
      if (step < 1 || Math.ceil((end - start) / step) > MAX_ITERATIONS) {
        throw new CompileError(`Use a positive loop step and at most ${MAX_ITERATIONS} iterations.`, token.offset);
      }
      this.expect(")");
      return { kind: "for", name, start, end, step, body: this.block(depth), token };
    }
    if (token.value === "print") {
      this.expect("(");
      const start = this.current.offset;
      const expression = this.expression();
      const label = this.source.slice(start, this.current.offset).trim();
      this.expect(")");
      this.expect(";");
      return { kind: "print", expression, label, token };
    }
    if (token.value === "break" || token.value === "continue") {
      this.expect(";");
      return { kind: token.value, token };
    }
    if (token.value === "return") {
      const expression = this.expression();
      this.expect(";");
      return { kind: "return", expression, token };
    }
    if (token.kind === "name" && !RESERVED.has(token.value)) {
      if (this.matches("(")) {
        this.cursor--;
        const expression = this.expression();
        if (expression.kind !== "call") throw new CompileError("Use a function call as a statement.", token.offset);
        this.expect(";");
        return { kind: "call", expression, token };
      }
      let index: Expression | undefined;
      if (this.matches("[")) {
        this.take();
        index = this.expression();
        this.expect("]");
      }
      this.expect("=");
      const expression = this.expression();
      this.expect(";");
      return { kind: "assign", name: token, index, expression };
    }
    throw new CompileError('Expected a declaration, assignment, if, for, break, continue, return, or print.', token.offset);
  }
  private expression(minPrecedence = 0, depth = 0): Expression {
    if (depth > MAX_DEPTH) throw new CompileError("This expression is too deeply nested.", this.current.offset);
    let left = this.primary(depth + 1);
    while (this.current.kind === "symbol" || this.current.kind === "name") {
      const operator = this.current.value;
      if (operator === "and" || operator === "or") {
        throw new CompileError(`Use ${operator === "and" ? "&&" : "||"} instead of ${operator}.`, this.current.offset);
      }
      const precedence = PRECEDENCE.get(operator) ?? -1;
      if (precedence < minPrecedence) break;
      const token = this.take();
      const right = this.expression(precedence + 1, depth + 1);
      left = { kind: "binary", operator, left, right, token };
    }
    // The ternary operator has the lowest precedence and associates to the right.
    if (minPrecedence === 0 && this.matches("?")) {
      const token = this.take();
      const yes = this.expression(0, depth + 1);
      this.expect(":");
      const no = this.expression(0, depth + 1);
      left = { kind: "conditional", condition: left, yes, no, token };
    }
    return left;
  }
  private primary(depth: number): Expression {
    const token = this.current;
    if (this.matches("if")) throw new CompileError("Use condition ? yes : no for conditional expressions; if is a statement.", token.offset);
    if (this.matches("not")) throw new CompileError("Use ! instead of not.", token.offset);
    if (["-", "+", "!"].some(operator => this.matches(operator))) {
      this.take();
      return { kind: "unary", operator: token.value, operand: this.expression(7, depth), token };
    }
    if (this.matches("(")) {
      this.take();
      const value = this.expression(0, depth);
      this.expect(")");
      return value;
    }
    if (token.kind === "number") return { kind: "number", value: this.number(), token };
    if (token.kind === "string") { this.take(); return { kind: "string", value: token.value, token }; }
    if (this.matches("true") || this.matches("false")) {
      this.take();
      return { kind: "number", value: token.value === "true" ? 1 : 0, token };
    }
    if (token.kind !== "name") throw new CompileError("Expected a number, string, variable, or expression.", token.offset);
    this.take();
    if (this.matches("[")) {
      this.take();
      const index = this.expression(0, depth);
      this.expect("]");
      return { kind: "index", name: token.value, index, token };
    }
    if (!this.matches("(")) return { kind: "reference", name: token.value, token };
    this.take();
    if (INPUT_FUNCTIONS.has(token.value)) {
      if (["click", "press", "arrow_x", "arrow_y"].includes(token.value) || (token.value === "hold_time" && this.current.kind !== "string")) {
        let input: Input;
        if (token.value === "click") input = { kind: "toggle", label: "", initial: false, global: true };
        else if (token.value === "press") input = { kind: "pressed", label: "", global: true };
        else {
          const maximum = this.matches(")") ? token.value === "hold_time" ? 1 : 100 : this.number(true);
          if (maximum <= 0 || (token.value === "hold_time" && maximum > 3600)) {
            throw new CompileError(token.value === "hold_time" ? "A hold timer's duration must be greater than 0 and at most 3600 seconds." : "An arrow input's maximum must be positive.", token.offset);
          }
          input = token.value === "hold_time"
            ? { kind: "hold_time", label: "", duration: maximum, global: true }
            : { kind: "scroll", label: "", axis: token.value === "arrow_x" ? "x" : "y", maximum, global: true };
        }
        this.expect(")");
        return { kind: "input", input, token };
      }
      const label = this.take();
      if (label.kind !== "string") throw new CompileError(`Give ${token.value} a quoted label, like ${token.value}("a").`, label.offset);
      let input: Input;
      if (token.value === "pressed") input = { kind: "pressed", label: label.value };
      else if (token.value === "hold_time") {
        let duration = 1;
        if (this.matches(",")) { this.take(); duration = this.number(true); }
        if (duration <= 0 || duration > 3600) throw new CompileError("A hold timer's duration must be greater than 0 and at most 3600 seconds.", token.offset);
        input = { kind: "hold_time", label: label.value, duration };
      }
      else if (token.value === "toggle") {
        let initial = 0;
        if (this.matches(",")) {
          this.take();
          initial = this.matches("true") || this.matches("false") ? Number(this.take().value === "true") : this.number(true);
        }
        if (initial !== 0 && initial !== 1) throw new CompileError("A toggle's initial value must be 0, 1, false, or true.", token.offset);
        input = { kind: "toggle", label: label.value, initial: initial === 1 };
      } else if (token.value === "typed") {
        this.expect(",");
        const character = this.take();
        if (character.kind !== "string" || !/^[\x20-\x7e]$/.test(character.value)) throw new CompileError('typed requires one printable ASCII character, such as typed("key", "w").', character.offset);
        input = { kind: "typed", label: label.value, character: character.value };
      } else if (token.value === "scroll_x" || token.value === "scroll_y") {
        let maximum = 100;
        if (this.matches(",")) { this.take(); maximum = this.number(true); }
        if (maximum <= 0) throw new CompileError("A scroll input's maximum must be positive.", token.offset);
        input = { kind: "scroll", label: label.value, axis: token.value === "scroll_x" ? "x" : "y", maximum };
      } else {
        let initial = 0;
        if (this.matches(",")) { this.take(); initial = this.number(true); }
        let maximum = 100;
        if (this.matches(",")) { this.take(); maximum = this.number(true); }
        let minimum = 0;
        if (this.matches(",")) { this.take(); minimum = this.number(true); }
        if (maximum <= minimum || initial > maximum || initial < minimum) throw new CompileError("The input maximum must exceed its minimum, and its initial value must be within that range.", token.offset);
        input = { kind: "slider", label: label.value, initial, maximum, minimum };
      }
      this.expect(")");
      return { kind: "input", input, token };
    }
    const required = FUNCTION_ARITY.get(token.value);
    const args: Expression[] = [];
    if (!this.matches(")")) {
      args.push(this.expression(0, depth));
      while (this.matches(",")) { this.take(); args.push(this.expression(0, depth)); }
    }
    this.expect(")");
    if (required !== undefined && required >= 0 && args.length !== required) throw new CompileError(`${token.value} takes ${required} ${required === 1 ? "argument" : "arguments"}.`, token.offset);
    return { kind: "call", name: token.value, args, token };
  }
}

function valueReference(id: number) { return `var(--v${id})`; }

function storedWidth(expression: string, type: ValueType) {
  if (type === "float") return `clamp(-${MAX_VALUE}px, ${expression}, ${MAX_VALUE}px)`;
  return `clamp(${type === "string" ? 0 : -MAX_VALUE}px, round(to-zero, ${expression}, 1px), ${MAX_VALUE}px)`;
}

// CSS sign() returns a unitless number. abs() makes every nonzero value true.
function truthy(value: string) { return `abs(sign(${value}))`; }
function booleanWidth(value: string) { return `calc((${value}) * 1px)`; }

type Invoke = (name: string, args: string[], token: Token, guard: string) => string;
type ExpressionHelpers = { invoke: Invoke; text: (value: string) => number; clock: (period: number) => string };
function lowerExpression(expression: Expression, symbols: Map<string, Binding>, helpers: ExpressionHelpers, depth = 0, guard = "1px"): string {
  if (depth > MAX_DEPTH) throw new CompileError("Split this expression into smaller variables.", expression.token.offset);
  const result = lowerValue(expression, symbols, helpers, depth, guard);
  // Branch selection repeats its predicate: bound every subtree before expansion.
  if (result.length > 40_000) throw new CompileError("Split this expression into smaller variables.", expression.token.offset);
  return result;
}

function lowerValue(expression: Expression, symbols: Map<string, Binding>, helpers: ExpressionHelpers, depth: number, guard: string): string {
  const lower = (value: Expression, active = guard) => lowerExpression(value, symbols, helpers, depth + 1, active);
  switch (expression.kind) {
    case "number": return `${expression.value}px`;
    case "string": return `${helpers.text(expression.value)}px`;
    case "reference": {
      const binding = symbols.get(expression.name);
      if (!binding) throw new CompileError(`Declare "${expression.name}" before using it.`, expression.token.offset);
      if (binding.array) throw new CompileError(`Index "${expression.name}" to use an element, like ${expression.name}[0].`, expression.token.offset);
      return binding.constant === undefined ? valueReference(binding.ids[0]) : `${binding.constant}px`;
    }
    case "index": {
      const binding = symbols.get(expression.name);
      if (!binding) throw new CompileError(`Declare "${expression.name}" before using it.`, expression.token.offset);
      if (!binding.array) throw new CompileError(`"${expression.name}" is not an array.`, expression.token.offset);
      const index = literalIndex(expression.index, binding.ids.length) ?? constantInteger(expression.index, name => symbols.get(name));
      if (index !== undefined) return index >= 0 && index < binding.ids.length ? valueReference(binding.ids[index]) : "0px";
      const width = `round(down, ${lower(expression.index)}, 1px)`;
      return `calc(${binding.ids.map((id, index) => `${equalMask(width, `${index}px`)} * ${valueReference(id)}`).join(" + ")})`;
    }
    case "input": throw new CompileError('Use input controls directly as top-level numeric initializers, such as int a = input("a");', expression.token.offset);
    case "unary": {
      const value = lower(expression.operand);
      if (expression.operator === "!") return booleanWidth(`1 - ${truthy(value)}`);
      return expression.operator === "-" ? `calc(-1 * ${value})` : value;
    }
    case "conditional": {
      const predicate = lower(expression.condition);
      const condition = truthy(predicate);
      const yes = lower(expression.yes, combineGuard(guard, predicate));
      const no = lower(expression.no, combineGuard(guard, booleanWidth(`1 - ${condition}`)));
      return `calc(${condition} * ${yes} + (1 - ${condition}) * ${no})`;
    }
    case "call": {
      if (expression.name === "time") return helpers.clock(expression.args[0]?.kind === "number" ? expression.args[0].value : 60);
      const args = expression.args.map(arg => lower(arg));
      if (!FUNCTION_ARITY.has(expression.name)) return helpers.invoke(expression.name, args, expression.token, guard);
      const value = args[0];
      switch (expression.name) {
        case "sign": return `calc(sign(${value}) * 1px)`;
        case "floor": return `round(down, ${value}, 1px)`;
        case "ceil": return `round(up, ${value}, 1px)`;
        case "round": return `round(nearest, ${value}, 1px)`;
        case "sqrt": return `calc(sqrt(max(0, ${value} / 1px)) * 1px)`;
        case "sin": case "cos": case "tan": return `calc(${expression.name}(calc(${value} / 1px)) * 1px)`;
        case "atan2": return `calc(atan2(${value}, ${args[1]}) / 1rad * 1px)`;
        case "mod":
        case "rem": {
          if (expression.args[1].kind === "number" && expression.args[1].value === 0) {
            throw new CompileError(`${expression.name} cannot use a zero divisor.`, expression.args[1].token.offset);
          }
          return moduloWidth(expression.name, value, args[1]);
        }
        default: return `${expression.name}(${args.join(", ")})`;
      }
    }
    case "binary": {
      const left = lower(expression.left);
      const rightGuard = expression.operator === "&&" ? combineGuard(guard, left)
        : expression.operator === "||" ? combineGuard(guard, booleanWidth(`1 - ${truthy(left)}`)) : guard;
      const right = lower(expression.right, rightGuard);
      if (["/", "%"].includes(expression.operator) && expression.right.kind === "number" && expression.right.value === 0) {
        throw new CompileError("Cannot divide by zero.", expression.right.token.offset);
      }
      switch (expression.operator) {
        case "%": return moduloWidth("mod", left, right);
        case "*": return `calc(${left} * (${right} / 1px))`;
        // Keep fractional and signed intermediates. A live zero divisor produces 0.
        case "/": {
          const nonzero = truthy(right);
          const divisor = `(${right} + (1 - ${nonzero}) * 1px)`;
          return `calc((${left} / ${divisor}) * ${nonzero} * 1px)`;
        }
        case "<": return booleanWidth(`max(0, sign(calc(${right} - ${left})))`);
        case ">": return booleanWidth(`max(0, sign(calc(${left} - ${right})))`);
        case "<=": return booleanWidth(`1 - max(0, sign(calc(${left} - ${right})))`);
        case ">=": return booleanWidth(`1 - max(0, sign(calc(${right} - ${left})))`);
        case "==": return booleanWidth(`1 - abs(sign(calc(${left} - ${right})))`);
        case "!=": return booleanWidth(`abs(sign(calc(${left} - ${right})))`);
        case "&&": return booleanWidth(`${truthy(left)} * ${truthy(right)}`);
        case "||": return booleanWidth(`max(${truthy(left)}, ${truthy(right)})`);
        default: return `calc(${left} ${expression.operator} ${right})`;
      }
    }
  }
}

function moduloWidth(name: string, left: string, right: string) {
  const nonzero = truthy(right);
  const divisor = `calc(${right} + (1 - ${nonzero}) * 1px)`;
  return `calc(${name}(${left}, ${divisor}) * ${nonzero})`;
}

function selectWidth(condition: string, yes: string, no: string) {
  const mask = truthy(condition);
  return `calc(${mask} * ${yes} + (1 - ${mask}) * ${no})`;
}

function combineGuard(parent: string, condition: string) {
  if (parent === "1px") return condition;
  if (condition === "1px" || parent === condition) return parent;
  return booleanWidth(`${truthy(parent)} * ${truthy(condition)}`);
}

function equalMask(left: string, right: string) {
  return `(1 - abs(sign(calc(${left} - ${right}))))`;
}

function literalIndex(expression: Expression, size: number): number | undefined {
  let index: number | undefined;
  if (expression.kind === "number") index = expression.value;
  else if (expression.kind === "unary" && ["+", "-"].includes(expression.operator) && expression.operand.kind === "number") {
    index = expression.operand.value * (expression.operator === "-" ? -1 : 1);
  }
  if (index !== undefined) index = Math.floor(index);
  if (index !== undefined && (index < 0 || index >= size)) throw new CompileError(`Array index must be between 0 and ${size - 1}.`, expression.token.offset);
  return index;
}

// Bindings are immutable snapshots: a scalar has one slot, an array has one
// per element. Scope forks may share a binding until an assignment replaces it.
type Binding = { ids: number[]; type?: ValueType; array?: boolean; readonly?: boolean; constant?: number };
type Scope = Map<string, Binding>;
type Context = { scopes: Scope[]; fn?: FunctionDefinition; loops?: number[]; guard?: string; tailIndex?: number };
enum Flow { Next = 1, Return = 2, Break = 4, Continue = 8 }

// Only fold small integer index arithmetic. Other math retains CSS semantics.
function constantInteger(expression: Expression, binding: (name: string) => Binding | undefined): number | undefined {
  let value: number | undefined;
  if (expression.kind === "number") value = expression.value;
  else if (expression.kind === "reference") value = binding(expression.name)?.constant;
  else if (expression.kind === "unary") {
    const operand = constantInteger(expression.operand, binding);
    if (operand !== undefined && expression.operator !== "!") value = expression.operator === "-" ? -operand : operand;
  } else if (expression.kind === "binary") {
    const a = constantInteger(expression.left, binding), b = constantInteger(expression.right, binding);
    if (a !== undefined && b !== undefined) {
      if (expression.operator === "+") value = a + b;
      else if (expression.operator === "-") value = a - b;
      else if (expression.operator === "*") value = a * b;
      else if (expression.operator === "%" && b !== 0) value = a - b * Math.floor(a / b);
    }
  }
  return value !== undefined && Number.isInteger(value) && Math.abs(value) <= MAX_VALUE ? value : undefined;
}

// Specialize short computational loops when their counter indexes an array.
// This removes per-element selection masks and lets an enclosing phase fuse
// the whole loop. Effects and nested loops keep the reusable backend.
function specializeArrayLoop(statement: Extract<Statement, { kind: "for" }>, count: number): boolean {
  if (statement.tail || count > 8) return false;
  let indexed = false;
  let work = 0;
  const usesCounter = (value: Expression): boolean => {
    if (value.kind === "reference") return value.name === statement.name.value;
    if (value.kind === "unary") return usesCounter(value.operand);
    if (value.kind === "binary") return usesCounter(value.left) || usesCounter(value.right);
    return false;
  };
  const index = (value: Expression) => {
    const known = constantInteger(value, name => name === statement.name.value ? { ids: [], constant: statement.start } : undefined);
    if (known === undefined) return false;
    indexed ||= usesCounter(value);
    return true;
  };
  const expression = (value: Expression): boolean => {
    switch (value.kind) {
      case "index": return index(value.index);
      case "unary": return expression(value.operand);
      case "binary": return expression(value.left) && expression(value.right);
      case "conditional": return expression(value.condition) && expression(value.yes) && expression(value.no);
      case "call": return FUNCTION_ARITY.has(value.name) && value.args.every(expression);
      case "input": return false;
      default: return true;
    }
  };
  const body = (statements: Statement[]): boolean => statements.every(item => {
    if (++work * count > 64) return false;
    switch (item.kind) {
      case "declare": return item.name.value !== statement.name.value && expression(item.expression);
      case "return": return expression(item.expression);
      case "array": return item.name.value !== statement.name.value && item.values.every(expression);
      case "assign": return (!item.index || index(item.index)) && expression(item.expression);
      case "if": return expression(item.condition) && body(item.yes) && body(item.no);
      case "break": case "continue": return true;
      default: return false;
    }
  });
  return body(statement.body) && indexed;
}

class Lowerer {
  readonly nodes: ValueNode[] = [];
  readonly prints: PrintedValue[] = [];
  private functions = new Map<string, FunctionDefinition>();
  private callStack: string[] = [];
  private checked = new Set<string>();
  private expansion = 0;
  private rules: StateRule[] = [];
  private sequence: { pending: Assignment[]; execution: Execution[] } = { pending: [], execution: [] };
  private native = new Map<string, NativeFunction>();
  private strings = [""];
  private clocks: Clock[] = [];
  private drawings: Drawing[] = [];
  private canvas = { width: 320, height: 240 };
  private hasCanvas = false;
  private recursive = new Set<string>();
  private recursionSteps: number;
  constructor(private options: CompilerOptions) {
    this.recursionSteps = options.recursionSteps ?? 64;
    if (!Number.isInteger(this.recursionSteps) || this.recursionSteps < 1 || this.recursionSteps > MAX_ITERATIONS) {
      throw new CompileError(`recursionSteps must be an integer between 1 and ${MAX_ITERATIONS}.`, 0);
    }
  }

  private flush() {
    if (!this.sequence.pending.length) return;
    const id = this.rules.length;
    this.rules.push({ id, assignments: this.sequence.pending });
    this.sequence.execution.push({ kind: "step", rule: id });
    this.sequence.pending = [];
  }
  private capture<T>(action: () => T) {
    const parent = this.sequence;
    this.sequence = { pending: [], execution: [] };
    try {
      const result = action();
      this.flush();
      return { result, execution: this.sequence.execution };
    } finally { this.sequence = parent; }
  }
  private probe(action: () => void) {
    const nodeCount = this.nodes.length;
    const ruleCount = this.rules.length;
    const drawingCount = this.drawings.length;
    const printCount = this.prints.length;
    try { this.capture(action); }
    finally { this.nodes.length = nodeCount; this.rules.length = ruleCount; this.drawings.length = drawingCount; this.prints.length = printCount; }
  }
  private assign(id: number, width: string) {
    this.sequence.pending.push({ id, width: storedWidth(width, this.nodes[id].type) });
  }
  private reserve(name: string, token: Token, type: ValueType = "int"): number {
    if (this.nodes.length >= MAX_NODES) throw new CompileError("This program needs too many CSS state slots. Reduce nested loops or function calls.", token.offset);
    const id = this.nodes.length;
    this.nodes.push({ id, name, width: "0px", type });
    return id;
  }

  private add(name: string, width: string, token: Token, type: ValueType = "int", input?: ValueNode["input"]): number {
    const id = this.reserve(name, token, type);
    this.nodes[id] = { id, name, width: storedWidth(width, type), type, ...(input ? { input } : {}) };
    if (!input) this.assign(id, width);
    return id;
  }
  private compatible(actual: ValueType, expected: ValueType, token: Token) {
    if ((actual === "string") !== (expected === "string")) throw new CompileError(`Expected ${expected === "string" ? "a string" : "a number"}, received ${actual}.`, token.offset);
  }
  private expressionType(expression: Expression, context: Context): ValueType {
    const type = (value: Expression) => this.expressionType(value, context);
    const numeric = (value: Expression) => {
      const result = type(value);
      this.compatible(result, "float", value.token);
      return result;
    };
    switch (expression.kind) {
      case "number": return /[.eE]/.test(expression.token.value) ? "float" : "int";
      case "string": return "string";
      case "input": return "float";
      case "reference": case "index": {
        const binding = this.find({ ...expression.token, value: expression.name }, context).get(expression.name)!;
        if (expression.kind === "index") {
          if (!binding.array) throw new CompileError(`"${expression.name}" is not an array.`, expression.token.offset);
          numeric(expression.index);
        } else if (binding.array) throw new CompileError(`Index "${expression.name}" to use an element, like ${expression.name}[0].`, expression.token.offset);
        return binding.type ?? "int";
      }
      case "unary": {
        const operand = numeric(expression.operand);
        return expression.operator === "!" ? "int" : operand;
      }
      case "conditional": {
        numeric(expression.condition);
        const yes = type(expression.yes), no = type(expression.no);
        this.compatible(no, yes, expression.no.token);
        return yes === "float" || no === "float" ? "float" : yes;
      }
      case "binary": {
        const left = type(expression.left), right = type(expression.right);
        if (["==", "!="].includes(expression.operator)) {
          this.compatible(right, left, expression.right.token);
          return "int";
        }
        this.compatible(left, "float", expression.left.token);
        this.compatible(right, "float", expression.right.token);
        if (["<", ">", "<=", ">=", "&&", "||"].includes(expression.operator)) return "int";
        return expression.operator === "/" || left === "float" || right === "float" ? "float" : "int";
      }
      case "call": {
        if (expression.name === "time") {
          const period = expression.args[0];
          if (expression.args.length > 1 || (period && (period.kind !== "number" || period.value <= 0 || period.value > 3600))) throw new CompileError("Use time() or time(seconds) with a positive literal up to 3600.", expression.token.offset);
          return "float";
        }
        if (FUNCTION_ARITY.has(expression.name)) {
          const types = expression.args.map(numeric);
          if (["sign", "floor", "ceil", "round"].includes(expression.name)) return "int";
          return ["sqrt", "hypot", "sin", "cos", "tan", "atan2"].includes(expression.name) || types.includes("float") ? "float" : "int";
        }
        const fn = this.functions.get(expression.name);
        if (!fn) throw new CompileError(`Unknown function "${expression.name}".`, expression.token.offset);
        if (fn.params.length !== expression.args.length) throw new CompileError(`${expression.name} takes ${fn.params.length} ${fn.params.length === 1 ? "argument" : "arguments"}.`, expression.token.offset);
        expression.args.forEach((arg, index) => this.compatible(type(arg), fn.params[index].type, arg.token));
        return fn.type;
      }
    }
  }
  private value(expression: Expression, context: Context, expected: ValueType = "float") {
    this.compatible(this.expressionType(expression, context), expected, expression.token);
    const symbols = new Map<string, Binding>();
    for (const scope of context.scopes) for (const [name, binding] of scope) symbols.set(name, binding);
    return lowerExpression(expression, symbols, {
      invoke: (name, args, token, guard) => {
        // An earlier call in the same expression may have exhausted its budget.
        const failed = context.scopes[0].get("#failed")?.ids[0];
        return this.invoke(name, args, token, failed === undefined ? guard
          : combineGuard(guard, booleanWidth(`1 - ${truthy(valueReference(failed))}`)), context);
      },
      text: value => this.strings.indexOf(value),
      clock: period => {
        let clock = this.clocks.find(clock => clock.period === period);
        if (!clock) { clock = { id: this.clocks.length, period }; this.clocks.push(clock); }
        return `var(--clock-${clock.id})`;
      },
    }, 0, this.outputActive(context));
  }
  private initialize(name: string, expression: Expression | undefined, token: Token, context: Context, type: ValueType): number {
    if (!expression) return this.add(name, "0px", token, type);
    if (expression.kind === "input") {
      this.compatible("float", type, token);
      if (context.fn || context.scopes.length !== 1) throw new CompileError("Declare inputs at the top level, outside functions and blocks.", expression.token.offset);
      const input = expression.input;
      if (input.kind === "slider" && type === "int" && ![input.initial, input.maximum, input.minimum].every(Number.isInteger)) throw new CompileError("Use a float input for fractional initial values or bounds.", expression.token.offset);
      const initial = input.kind === "slider" ? input.initial : input.kind === "toggle" ? Number(input.initial) : 0;
      return this.add(name, `${initial}px`, token, type, input);
    }
    return this.add(name, this.value(expression, context, type), token, type);
  }
  private printedValue(expression: Expression, label: string, context: Context): PrintedValue {
    const choices: PrintChoice[] = [];
    const containsText = (value: Expression): boolean => value.kind === "conditional"
      ? containsText(value.yes) || containsText(value.no)
      : this.expressionType(value, context) === "string";
    const select = (value: Expression, branch = context): string => {
      if (value.kind === "conditional" && containsText(value)) {
        // Select a source branch, not an enumerated input value. The numeric
        // fallback remains a live calculation, just like an ordinary print.
        const condition = this.add("output condition", booleanWidth(truthy(this.value(value.condition, branch))), value.token);
        const yes = select(value.yes, { ...branch, guard: combineGuard(branch.guard ?? "1px", valueReference(condition)) });
        const no = select(value.no, { ...branch, guard: combineGuard(branch.guard ?? "1px", booleanWidth(`1 - ${truthy(valueReference(condition))}`)) });
        return valueReference(this.add("output choice", selectWidth(valueReference(condition), yes, no), value.token));
      }
      if (value.kind === "string") choices.push({ text: value.value });
      else {
        const type = this.expressionType(value, context);
        const width = this.value(value, branch, type);
        if (type === "string") {
          const offset = choices.length;
          choices.push(...this.strings.map(text => ({ text })));
          return `calc(${width} + ${offset}px)`;
        }
        const nodeId = value.kind === "reference"
          ? this.find({ ...value.token, value: value.name }, context).get(value.name)!.ids[0]
          : this.add(label, width, value.token, type);
        choices.push({ nodeId });
      }
      return `${choices.length - 1}px`;
    };
    const selector = select(expression);
    return { label, choices, ...(choices.length > 1 ? { selectorId: this.add("output", selector, expression.token) } : {}) };
  }
  private find(name: Token, context: Context): Scope {
    const scope = context.scopes.findLast(scope => scope.has(name.value));
    if (!scope) throw new CompileError(`Declare "${name.value}" before using it.`, name.offset);
    return scope;
  }
  private fork(context: Context): Context {
    return { ...context, scopes: context.scopes.map(scope => new Map(scope)) };
  }
  private active(context: Context): string {
    const ids = [
      ...(context.fn ? [context.scopes[0].get("#alive")!.ids[0]] : []),
      ...(context.loops ?? []).map(index => context.scopes[index].get("#iteration")!.ids[0]),
    ];
    const failed = context.scopes[0].get("#failed")?.ids[0];
    const running = !ids.length ? "1px" : ids.length === 1 ? valueReference(ids[0]) : booleanWidth(ids.map(id => truthy(valueReference(id))).join(" * "));
    return failed === undefined ? running : combineGuard(running, booleanWidth(`1 - ${truthy(valueReference(failed))}`));
  }
  private outputActive(context: Context): string {
    return combineGuard(context.guard ?? "1px", this.active(context));
  }
  private loopScope(context: Context, token: Token): Scope {
    const scope: Scope = new Map();
    scope.set("#running", { ids: [this.add("loop active", "1px", token)] });
    scope.set("#iteration", { ids: [this.add("iteration active", "1px", token)] });
    context.loops = [...context.loops ?? [], context.scopes.length];
    context.scopes.push(scope);
    return scope;
  }
  private block(statements: Statement[], context: Context, scoped = true): Flow {
    if (scoped) context.scopes.push(new Map());
    let flow = Flow.Next;
    for (const statement of statements) {
      if (++this.expansion > MAX_EXPANSION) throw new CompileError("This program expands to too many statements. Reduce nested loops or calls.", "name" in statement ? statement.name.offset : statement.token.offset);
      // Validate unreachable code too; it cannot change the reachable exits.
      const next = this.statement(statement, context);
      if (flow & Flow.Next) flow = (flow & ~Flow.Next) | next;
    }
    if (scoped) context.scopes.pop();
    return flow;
  }
  private statement(statement: Statement, context: Context): Flow {
    switch (statement.kind) {
      case "function": return Flow.Next;
      case "call":
        this.value(statement.expression, context, this.expressionType(statement.expression, context));
        return Flow.Next;
      case "declare":
      case "array": {
        const scope = context.scopes.at(-1)!;
        const name = statement.name.value;
        if (scope.has(name)) throw new CompileError(`"${name}" is already declared in this scope.`, statement.name.offset);
        if (statement.kind === "array") {
          const ids = Array.from({ length: statement.size }, (_, index) => this.initialize(`${name}[${index}]`, statement.values[index], statement.name, context, statement.type));
          scope.set(name, { ids, type: statement.type, array: true });
        } else {
          scope.set(name, { ids: [this.initialize(name, statement.expression, statement.name, context, statement.type)], type: statement.type });
        }
        return Flow.Next;
      }
      case "assign": {
        const scope = this.find(statement.name, context);
        const binding = scope.get(statement.name.value)!;
        if (binding.readonly) throw new CompileError("The unrolled loop counter cannot be reassigned in its body.", statement.name.offset);
        if (binding.array && !statement.index) throw new CompileError(`Assign an element, like ${statement.name.value}[0] = 1.`, statement.name.offset);
        if (!binding.array && statement.index) throw new CompileError(`"${statement.name.value}" is not an array.`, statement.name.offset);
        const index = statement.index ? literalIndex(statement.index, binding.ids.length)
          ?? constantInteger(statement.index, name => context.scopes.findLast(scope => scope.has(name))?.get(name)) : 0;
        // Snapshot the signed index before evaluating and applying the write.
        const selector = index === undefined
          ? valueReference(this.add("array index", `round(down, ${this.value(statement.index!, context)}, 1px)`, statement.name))
          : undefined;
        const type = binding.type ?? "int";
        const width = this.value(statement.expression, context, type);
        const next = selector ? valueReference(this.add("array value", width, statement.name, type)) : width;
        const active = context.fn || context.loops?.length ? this.active(context) : undefined;
        const ids = binding.ids.map((id, element) => {
          if (index !== undefined && element !== index) return id;
          const previous = valueReference(id);
          const selected = selector ? selectWidth(booleanWidth(equalMask(selector, `${element}px`)), next, previous) : next;
          const guarded = active ? selectWidth(active, selected, previous) : selected;
          return this.add(binding.array ? `${statement.name.value}[${element}]` : statement.name.value, guarded, statement.name, type);
        });
        scope.set(statement.name.value, { ...binding, ids });
        return Flow.Next;
      }
      case "if": {
        // Snapshot the predicate before either branch can reassign its operands.
        const condition = this.add("condition", booleanWidth(truthy(this.value(statement.condition, context))), statement.token);
        const yes = this.fork(context);
        const no = this.fork(context);
        yes.guard = combineGuard(context.guard ?? "1px", valueReference(condition));
        no.guard = combineGuard(context.guard ?? "1px", booleanWidth(`1 - ${truthy(valueReference(condition))}`));
        const yesReturns = this.block(statement.yes, yes);
        const noReturns = this.block(statement.no, no);
        for (const [index, scope] of context.scopes.entries()) {
          for (const [name, binding] of scope) {
            const a = yes.scopes[index].get(name)!;
            const b = no.scopes[index].get(name)!;
            const ids = a.ids.map((id, element) => id === b.ids[element] ? id : this.add(name,
              selectWidth(valueReference(condition), valueReference(id), valueReference(b.ids[element])), statement.token, binding.type));
            scope.set(name, { ...binding, ids });
          }
        }
        return yesReturns | noReturns;
      }
      case "for": {
        const count = Math.max(0, Math.ceil((statement.end - statement.start) / statement.step));
        if (!count) {
          this.probe(() => {
            const probe = this.fork(context);
            const scope = this.loopScope(probe, statement.token);
            scope.set(statement.name.value, { ids: [this.add(statement.name.value, `${statement.start}px`, statement.name)], readonly: true });
            this.block(statement.body, probe);
          });
          return Flow.Next;
        }
        const parentLoops = context.loops;
        const controlIndex = context.scopes.length;
        this.loopScope(context, statement.token);
        if (specializeArrayLoop(statement, count)) {
          let flow = 0;
          for (let i = 0; i < count; i++) {
            const control = context.scopes[controlIndex];
            control.set("#iteration", { ids: [this.add("iteration active", valueReference(control.get("#running")!.ids[0]), statement.token)] });
            const constant = statement.start + i * statement.step;
            context.scopes.push(new Map([[statement.name.value, {
              ids: [this.add(statement.name.value, `${constant}px`, statement.name)], readonly: true, constant,
            }]]));
            flow |= this.block(statement.body, context);
            context.scopes.pop();
          }
          context.scopes.pop();
          context.loops = parentLoops;
          return (flow & Flow.Return) | (flow & (Flow.Next | Flow.Break | Flow.Continue) ? Flow.Next : 0);
        }
        // Two banks let a step read inherited state while writing the other bank.
        // Every declaration and selector is compiled twice, regardless of count.
        const banks = [0, 1].map(() => context.scopes.map(scope => new Map(
          [...scope].map(([name, binding]) => [name, { ...binding, ids: binding.ids.map(() => this.reserve(name, statement.token, binding.type)) }]),
        )));
        const counters = [this.reserve(statement.name.value, statement.name), this.reserve(statement.name.value, statement.name)];
        for (const [index, scope] of context.scopes.entries()) {
          for (const [name, binding] of scope) binding.ids.forEach((id, element) => this.assign(banks[0][index].get(name)!.ids[element], valueReference(id)));
        }
        this.assign(counters[0], `${statement.start}px`);
        this.flush();
        const phase = (from: number, to: number) => this.capture(() => {
          const iteration: Context = { ...context, scopes: banks[from].map(scope => new Map(scope)), ...(statement.tail ? { tailIndex: controlIndex } : {}) };
          // Continue resets for each iteration; break persists across iterations.
          const control = iteration.scopes[controlIndex];
          control.set("#iteration", { ids: [this.add("iteration active", valueReference(control.get("#running")!.ids[0]), statement.token)] });
          iteration.scopes.push(new Map([[statement.name.value, { ids: [counters[from]], readonly: true }]]));
          const returns = this.block(statement.body, iteration);
          for (const [index, scope] of banks[to].entries()) {
            for (const [name, binding] of scope) binding.ids.forEach((id, element) => this.assign(id, valueReference(iteration.scopes[index].get(name)!.ids[element])));
          }
          this.assign(counters[to], `calc(${valueReference(counters[from])} + ${statement.step}px)`);
          return returns;
        });
        const odd = phase(0, 1);
        const even = phase(1, 0);
        this.sequence.execution.push({ kind: "repeat", count, odd: odd.execution, even: even.execution });
        for (const [index, scope] of context.scopes.entries()) {
          for (const name of scope.keys()) scope.set(name, banks[count % 2][index].get(name)!);
        }
        context.scopes.pop();
        context.loops = parentLoops;
        // A break/continue exits the body, not the function. The fixed loop can
        // finish without returning whenever any body path falls through or jumps.
        return (odd.result & Flow.Return) | (odd.result & (Flow.Next | Flow.Break | Flow.Continue) ? Flow.Next : 0);
      }
      case "break":
      case "continue": {
        const index = context.loops?.findLast(index => index !== context.tailIndex);
        if (index === undefined) throw new CompileError(`Use ${statement.kind} inside a for loop.`, statement.token.offset);
        const scope = context.scopes[index];
        const active = this.active(context);
        if (statement.kind === "break") {
          const previous = valueReference(scope.get("#running")!.ids[0]);
          scope.set("#running", { ids: [this.add("break", selectWidth(active, "0px", previous), statement.token)] });
        }
        const previous = valueReference(scope.get("#iteration")!.ids[0]);
        scope.set("#iteration", { ids: [this.add(statement.kind, selectWidth(active, "0px", previous), statement.token)] });
        return statement.kind === "break" ? Flow.Break : Flow.Continue;
      }
      case "return": {
        if (!context.fn) throw new CompileError("Use return inside a function.", statement.token.offset);
        if (context.tailIndex !== undefined) {
          const expression = statement.expression;
          if (expression.kind === "conditional") {
            // A recursive call in either result branch is still in tail position.
            this.compatible(this.expressionType(expression, context), context.fn.type, expression.token);
            return this.statement({ kind: "if", condition: expression.condition,
              yes: [{ ...statement, expression: expression.yes }], no: [{ ...statement, expression: expression.no }], token: statement.token }, context);
          }
          if (expression.kind === "call" && expression.name === context.fn.name.value) {
            this.expressionType(expression, context);
            // Snapshot all arguments before replacing any parameter, including
            // when an inner block shadows a parameter's name.
            const args = expression.args.map((arg, index) => this.add("tail argument", this.value(arg, context, context.fn!.params[index].type), arg.token, context.fn!.params[index].type));
            const active = this.active(context);
            const scope = context.scopes[0];
            context.fn.params.forEach((param, index) => {
              const previous = scope.get(param.name.value)!;
              scope.set(param.name.value, { ...previous, ids: [this.add(param.name.value,
                selectWidth(active, valueReference(args[index]), valueReference(previous.ids[0])), param.name, param.type)] });
            });
            const control = context.scopes[context.tailIndex];
            const previous = control.get("#iteration")!;
            control.set("#iteration", { ids: [this.add("tail call", selectWidth(active, "0px", valueReference(previous.ids[0])), expression.token)] });
            return Flow.Return;
          }
        }
        const scope = context.scopes[0];
        const alive = scope.get("#alive")!.ids[0];
        const previous = scope.get("#return")!.ids[0];
        const type = context.fn.type;
        const value = this.value(statement.expression, context, type);
        scope.set("#return", { ids: [this.add("return", selectWidth(this.active(context), value, valueReference(previous)), statement.token, type)], type });
        scope.set("#alive", { ids: [this.add("returned", selectWidth(this.active(context), "0px", valueReference(alive)), statement.token)] });
        return Flow.Return;
      }
      case "print": {
        let printed: PrintedValue[] | undefined;
        if (statement.expression.kind === "reference") {
          const name = statement.expression.name;
          const binding = this.find({ ...statement.expression.token, value: name }, context).get(name)!;
          if (binding.array) {
            printed = binding.ids.map((nodeId, index) => binding.type === "string"
              ? { label: `${name}[${index}]`, choices: this.strings.map(text => ({ text })), selectorId: nodeId }
              : { label: `${name}[${index}]`, choices: [{ nodeId }] });
          }
        }
        // Evaluate nested calls first: their output precedes this print.
        printed ??= [this.printedValue(statement.expression, statement.label, context)];
        const active = this.outputActive(context);
        const visible = active === "1px" ? undefined : this.add("print active", booleanWidth(truthy(active)), statement.token);
        this.flush();
        for (const value of printed) {
          const index = this.prints.length;
          this.prints.push({ ...value, visible });
          this.sequence.execution.push({ kind: "print", printed: index });
        }
        return Flow.Next;
      }
      case "canvas": {
        if (context.fn || context.scopes.length !== 1) throw new CompileError("Configure the canvas at the top level.", statement.token.offset);
        if (this.hasCanvas) throw new CompileError("Use one canvas per program.", statement.token.offset);
        this.hasCanvas = true;
        this.canvas = { width: statement.width, height: statement.height };
        return Flow.Next;
      }
      case "draw": {
        const count = DRAWING_ARITY.get(statement.shape)!;
        const color = statement.args[count];
        if (color && (color.kind !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color.value))) throw new CompileError('Use a literal hex color, such as "#647a55".', color.token.offset);
        const values = statement.args.slice(0, count).map(arg => this.add(statement.shape, this.value(arg, context), arg.token, "float"));
        const visible = this.add("draw active", booleanWidth(truthy(this.outputActive(context))), statement.token);
        const drawing = this.drawings.length;
        this.drawings.push({ kind: statement.shape, values, visible, color: color?.kind === "string" ? color.value : "#33372f" });
        // Emit at this state snapshot, before a later iteration reuses its slots.
        this.flush();
        this.sequence.execution.push({ kind: "draw", drawing });
        return Flow.Next;
      }
    }
  }
  // Functions that loop, recurse, print, or draw, and their callers, use DOM state.
  private canUseNative(name: string, visiting = new Set<string>()): boolean {
    const fn = this.functions.get(name);
    if (!fn || visiting.has(name)) return false;
    const next = new Set(visiting).add(name);
    const expression = (value: Expression): boolean => {
      switch (value.kind) {
        case "input": return false;
        case "call": return (FUNCTION_ARITY.has(value.name) || this.canUseNative(value.name, next)) && value.args.every(expression);
        case "index": return expression(value.index);
        case "unary": return expression(value.operand);
        case "binary": return expression(value.left) && expression(value.right);
        case "conditional": return expression(value.condition) && expression(value.yes) && expression(value.no);
        default: return true;
      }
    };
    const block = (statements: Statement[]): boolean => statements.every(statement => {
      if (statement.kind === "for" || statement.kind === "print" || statement.kind === "draw" || statement.kind === "canvas" || statement.kind === "function" || statement.kind === "break" || statement.kind === "continue") return false;
      if (statement.kind === "if") return expression(statement.condition) && block(statement.yes) && block(statement.no);
      if (statement.kind === "array") return statement.values.every(expression);
      if (statement.kind === "assign" && statement.index && !expression(statement.index)) return false;
      return expression(statement.expression);
    });
    return block(fn.body);
  }
  private nativeFunction(name: string, fn: FunctionDefinition): NativeFunction {
    const existing = this.native.get(name);
    if (existing) return existing;
    const base = this.nodes.length;
    const parameters = fn.params.map((_, index) => `--arg${index}`);
    let result = "";
    let declarations: string[] = [];
    const local = (value: string) => value.replace(/var\(--v(\d+)\)/g, (_, id: string) => `var(--local${Number(id) - base})`);
    this.probe(() => {
      result = this.inlineFunction(name, fn, parameters.map(param => `var(${param})`), fn.name);
      declarations = this.nodes.slice(base).map(node => `  --local${node.id - base}: ${local(node.width)};`);
      result = local(result);
    });
    const definition = { name: `--fn${[...this.functions.keys()].indexOf(name)}`, parameters, declarations, result };
    this.native.set(name, definition);
    return definition;
  }
  private invoke(name: string, args: string[], token: Token, guard = "1px", caller?: Context): string {
    const fn = this.functions.get(name);
    if (!fn) throw new CompileError(`Unknown function "${name}".`, token.offset);
    if (args.length !== fn.params.length) throw new CompileError(`${name} takes ${fn.params.length} ${fn.params.length === 1 ? "argument" : "arguments"}.`, token.offset);
    if (this.callStack.includes(name)) throw new CompileError(name === this.callStack.at(-1)
      ? "Tail recursion requires a direct self-call in a return, such as return f(next); work after the recursive result is unsupported."
      : "Mutual recursion is unsupported. Use a direct tail call to the same function.", token.offset);
    if (this.callStack.length >= MAX_DEPTH) throw new CompileError("These function calls are too deeply nested.", token.offset);
    if (this.options.cssFunctions && this.canUseNative(name)) {
      const definition = this.nativeFunction(name, fn);
      return `${definition.name}(${args.map((arg, index) => storedWidth(arg, fn.params[index].type)).join(", ")})`;
    }
    return this.inlineFunction(name, fn, args, token, guard, caller);
  }
  private inlineFunction(name: string, fn: FunctionDefinition, args: string[], token: Token, guard = "1px", caller?: Context): string {
    this.callStack.push(name);
    this.checked.add(name);
    const scope: Scope = new Map();
    for (const [index, param] of fn.params.entries()) {
      if (scope.has(param.name.value)) throw new CompileError(`Duplicate parameter "${param.name.value}".`, param.name.offset);
      scope.set(param.name.value, { ids: [this.add(param.name.value, args[index], param.name, param.type)], type: param.type });
    }
    scope.set("#alive", { ids: [this.add("active", "1px", token)] });
    scope.set("#return", { ids: [this.add("result", "0px", token, fn.type)], type: fn.type });
    if (this.recursive.size) {
      const previous = caller?.scopes[0].get("#failed")?.ids[0];
      scope.set("#failed", { ids: [this.add("runtime failure", previous === undefined ? "0px" : valueReference(previous), token)] });
    }
    const context: Context = { scopes: [scope], fn, guard };
    let flow: Flow;
    if (this.recursive.has(name)) {
      // The generated loop adds a fresh scope per call. Retain the original
      // parameter/body redeclaration rule before introducing that scope.
      for (const statement of fn.body) if ((statement.kind === "declare" || statement.kind === "array") && scope.has(statement.name.value)) {
        throw new CompileError(`"${statement.name.value}" is already declared in this scope.`, statement.name.offset);
      }
      flow = this.statement({ kind: "for", name: { ...fn.name, value: "#tail-step" }, start: 0,
        end: this.recursionSteps, step: 1, body: fn.body, token: fn.name, tail: true }, context);
      const exhausted = this.add("recursion exhausted", this.outputActive(context), token);
      this.flush();
      const printed = this.prints.length;
      this.prints.push({ label: "Runtime error", choices: [{ text: `Recursion limit reached in ${name} (${this.recursionSteps} calls).` }], visible: exhausted, error: true });
      this.sequence.execution.push({ kind: "print", printed });
      scope.set("#failed", { ids: [this.add("runtime failure", `max(${valueReference(scope.get("#failed")!.ids[0])}, ${valueReference(exhausted)})`, token)] });
    } else flow = this.block(fn.body, context, false);
    if (flow !== Flow.Return) throw new CompileError(`Function "${name}" must return a value on every path.`, fn.name.offset);
    if (caller && this.recursive.size) caller.scopes[0].set("#failed", scope.get("#failed")!);
    this.callStack.pop();
    return valueReference(scope.get("#return")!.ids[0]);
  }
  lower(statements: Statement[]): Program {
    // A loop can print a string assigned later in its body, on the next pass.
    // Intern the whole literal vocabulary before creating any output choices.
    const text = (value: Expression): void => {
      switch (value.kind) {
        case "string": if (!this.strings.includes(value.value)) this.strings.push(value.value); break;
        case "index": text(value.index); break;
        case "unary": text(value.operand); break;
        case "binary": text(value.left); text(value.right); break;
        case "conditional": text(value.condition); text(value.yes); text(value.no); break;
        case "call": value.args.forEach(text); break;
      }
    };
    const intern = (body: Statement[]): void => {
      for (const statement of body) switch (statement.kind) {
        case "function": case "for": intern(statement.body); break;
        case "if": text(statement.condition); intern(statement.yes); intern(statement.no); break;
        case "array": statement.values.forEach(text); break;
        case "draw": statement.args.slice(0, DRAWING_ARITY.get(statement.shape)!).forEach(text); break;
        case "assign": if (statement.index) text(statement.index); text(statement.expression); break;
        case "declare": case "print": case "return": case "call": text(statement.expression); break;
      }
    };
    intern(statements);
    for (const statement of statements) {
      if (statement.kind !== "function") continue;
      if (this.functions.has(statement.name.value)) throw new CompileError(`Function "${statement.name.value}" is already declared.`, statement.name.offset);
      this.functions.set(statement.name.value, statement);
    }
    const calls = (expression: Expression, name: string): boolean => {
      switch (expression.kind) {
        case "call": return expression.name === name || expression.args.some(arg => calls(arg, name));
        case "index": return calls(expression.index, name);
        case "unary": return calls(expression.operand, name);
        case "binary": return calls(expression.left, name) || calls(expression.right, name);
        case "conditional": return calls(expression.condition, name) || calls(expression.yes, name) || calls(expression.no, name);
        default: return false;
      }
    };
    const selfCalls = (body: Statement[], name: string): boolean => body.some(statement => {
      switch (statement.kind) {
        case "for": return selfCalls(statement.body, name);
        case "if": return calls(statement.condition, name) || selfCalls(statement.yes, name) || selfCalls(statement.no, name);
        case "array": return statement.values.some(value => calls(value, name));
        case "draw": return statement.args.some(arg => calls(arg, name));
        case "assign": return !!statement.index && calls(statement.index, name) || calls(statement.expression, name);
        case "declare": case "print": case "return": case "call": return calls(statement.expression, name);
        default: return false;
      }
    });
    for (const [name, fn] of this.functions) if (selfCalls(fn.body, name)) this.recursive.add(name);
    const context: Context = { scopes: [new Map()] };
    if (this.recursive.size) context.scopes[0].set("#failed", { ids: [this.add("runtime failure", "0px", statements.find(statement => statement.kind === "function")!.name)] });
    this.block(statements, context, false);
    // Check unused definitions too, discarding their temporary values.
    for (const [name, fn] of this.functions) {
      if (this.checked.has(name)) continue;
      this.probe(() => { this.invoke(name, fn.params.map(() => "1px"), fn.name); });
    }
    this.flush();
    const count = (execution: Execution[], kind: "step" | "draw" | "print"): number => execution.reduce((sum, step) => {
      if (step.kind === "repeat") return sum + Math.ceil(step.count / 2) * count(step.odd, kind) + Math.floor(step.count / 2) * count(step.even, kind);
      if (step.kind !== kind || (step.kind === "print" && this.prints[step.printed].error)) return sum;
      return sum + 1;
    }, 0);
    const inputs = this.nodes.filter(node => node.input).length;
    const inputLayers = this.nodes.filter(node => node.input?.kind === "slider").length * 2 + Number(this.nodes.some(node => node.input?.kind === "scroll" || node.input?.kind === "hold_time"));
    if (count(this.sequence.execution, "step") + inputLayers > 480) throw new CompileError("This program needs too many nested execution steps for HTML. Reduce loop bounds or nesting.", 0);
    return {
      html: renderDocument({ nodes: this.nodes, rules: this.rules, execution: this.sequence.execution, prints: this.prints, functions: [...this.native.values()], drawings: this.drawings, clocks: this.clocks, canvas: this.canvas }),
      variables: [...context.scopes[0].keys()].filter(name => !name.startsWith("#")).length,
      inputs,
      outputs: count(this.sequence.execution, "print") + count(this.sequence.execution, "draw"),
      cssFunctions: this.options.cssFunctions ?? false,
    };
  }
}

export function compile(source: string, options: CompilerOptions = {}): Compilation {
  try {
    if (source.length > MAX_SOURCE) throw new CompileError(`Keep programs under ${MAX_SOURCE.toLocaleString("en-US")} characters.`, MAX_SOURCE);
    const statements = new Parser(tokenize(source), source).parse();
    return { ok: true, program: new Lowerer(options).lower(statements) };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    const before = source.slice(0, error.offset);
    return { ok: false, error: { message: error.message, offset: error.offset, line: before.split("\n").length, column: error.offset - before.lastIndexOf("\n") } };
  }
}
