import { describe, expect, it } from 'vitest';
import { analyticsConfigFrom, cleanProps } from './analytics';

describe('analytics', () => {
  it('is off unless a valid Umami website id is configured', () => {
    expect(analyticsConfigFrom({})).toBeNull();
    expect(analyticsConfigFrom({ VITE_UMAMI_WEBSITE_ID: 'abc' })).toBeNull();
    expect(analyticsConfigFrom({ VITE_UMAMI_WEBSITE_ID: '3f1c2b9e-1111-4a2b-9c3d-123456789abc' })).not.toBeNull();
    expect(analyticsConfigFrom({ VITE_UMAMI_WEBSITE_ID: '3f1c2b9e-1111-4a2b-9c3d-123456789abc', VITE_UMAMI_SCRIPT: 'http://insecure/x.js' })).toBeNull();
  });

  it('drops anything that could identify a player', () => {
    expect(cleanProps({ mode: 'orbs', level: 3, email: 'a@b.com', name: 'Riya Sharma', key: 'ABCD1234-ABCD1234-ABCD1234-ABCD1234' })).toEqual({ mode: 'orbs', level: 3 });
    expect(cleanProps({ Bad_Key: 1 })).toBeUndefined();
  });
});
