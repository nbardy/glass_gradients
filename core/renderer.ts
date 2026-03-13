/**
 * Minimal renderer interface.
 * Each algorithm implements this and manages its own GPU resources.
 */
export interface AlgoRenderer {
  name: string;
  render(timestamp: number): Promise<void>;
  getStats(): Record<string, any>;
  dispose(): void;
}
