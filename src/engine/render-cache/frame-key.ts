import { resolveItem } from '../../core/resolve';
import type { CompositionFrame, LayerFrame } from '../../core/timeline';

export interface FrameKeyContext {
  readonly width: number;
  readonly height: number;
  readonly bypass: boolean;
  readonly viewNode: { readonly itemId: string; readonly nodeId: string } | null;
  readonly generation: number;
  readonly color: string;
}

const TIME_STEP = 1e4;

function layerKey(layer: LayerFrame): unknown {
  const { item } = layer.placement;
  const resolved = resolveItem(item, layer.local);
  return {
    id: item.id,
    kind: item.kind,
    source: item.kind === 'media' ? [item.source.assetId, Math.round(layer.sourceTime * TIME_STEP)] : item.text,
    local: Math.round(layer.local * TIME_STEP),
    effects: resolved.effects,
    transform: resolved.transform,
    opacity: resolved.opacity,
    graph: item.graph ?? null,
  };
}

export function describeFrame(frame: CompositionFrame, context: FrameKeyContext): string {
  return JSON.stringify({
    c: context,
    l: frame.layers.map((layer) => ({
      base: layerKey(layer.base),
      transition: layer.transition && { incoming: layerKey(layer.transition.incoming), type: layer.transition.transition, progress: Math.round(layer.transition.progress * TIME_STEP) },
    })),
  });
}

export function hashString(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export const frameKey = (frame: CompositionFrame, context: FrameKeyContext): string => hashString(describeFrame(frame, context));
