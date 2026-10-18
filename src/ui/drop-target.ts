export interface DropPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface DropTarget {
  hover(point: DropPoint, assetId: string): boolean;
  drop(point: DropPoint, assetId: string): string | null;
  leave(): void;
}
