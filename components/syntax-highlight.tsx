"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { parse } from "gpu-lexer";

type Highlight = { source: string; spans: Awaited<ReturnType<typeof parse>> };

export function SyntaxHighlight({ source, ref, variant = "editor" }: {
  source: string;
  ref?: RefObject<HTMLPreElement | null>;
  variant?: "editor" | "generated";
}) {
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const unavailable = useRef(false);

  useEffect(() => {
    if (unavailable.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { parse } = await import("gpu-lexer");
        if (cancelled) return;
        const spans = await parse(source);
        if (!cancelled) setHighlight({ source, spans });
      } catch {
        // Both code views remain readable without WebGPU or after device loss.
        unavailable.current = true;
      }
    }, 80);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source]);

  return (
    <pre ref={ref} className={variant === "editor" ? "source-highlight" : "generated-code"}
      aria-hidden={variant === "editor" ? true : undefined}
      aria-label={variant === "generated" ? "Compiled HTML and CSS" : undefined}
      tabIndex={variant === "generated" ? 0 : undefined}>
      {highlight?.source === source
        ? highlight.spans.map(span => <span key={span.start} className={`syntax-${span.type}`}>{source.slice(span.start, span.end)}</span>)
        : source}
      {"\n"}
    </pre>
  );
}
