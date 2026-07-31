import { describe, expect, it, vi } from 'vitest';
import { ComputeService } from '../src/agent/compute.js';

describe('ComputeService', () => {
  it('runs exact arithmetic in the bounded runtime', async () => {
    const service = new ComputeService(
      {
        complete: vi.fn(async () => ({
          content: `<js>
let base = 987654321987654321n;
let exponent = 1234567n;
const modulus = 10n ** 17n;
let result = 1n;
base %= modulus;
while (exponent > 0n) {
  if (exponent & 1n) result = result * base % modulus;
  base = base * base % modulus;
  exponent >>= 1n;
}
console.log(result.toString().padStart(17, '0'));
</js>`,
          toolCalls: [],
          finishReason: 'stop',
        })),
      } as never,
      { warn: vi.fn() } as never,
    );

    await expect(service.runIfUseful('last 17 digits')).resolves.toBe('65805737490085841');
  });

  it('lets the model decline the runtime for ordinary conversation', async () => {
    const service = new ComputeService(
      {
        complete: vi.fn(async () => ({
          content: '<none/>',
          toolCalls: [],
          finishReason: 'stop',
        })),
      } as never,
      { warn: vi.fn() } as never,
    );
    await expect(service.runIfUseful('how are you?')).resolves.toBeNull();
  });

  it('rejects generated code that reaches outside the isolated runtime', async () => {
    const service = new ComputeService(
      {
        complete: vi.fn(async () => ({
          content: '<js>console.log(process.env)</js>',
          toolCalls: [],
          finishReason: 'stop',
        })),
      } as never,
      { warn: vi.fn() } as never,
    );
    await expect(service.runIfUseful('show environment')).rejects.toThrow(
      'unsafe computation program',
    );
  });
});
