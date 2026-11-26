import { describe, expect, it } from 'vitest';
import { getAttributes } from '../htmlAttributes';

describe('getAttributes width and height validation', () => {
    it('allows literal 100% on img width while rejecting percentage heights and invalid widths', () => {
        expect(getAttributes('<img src="a.png" width="100%" height="100%" />')).toEqual({
            title: '',
            src: 'a.png',
            alt: '',
            width: '100%',
            height: '',
        });
        expect(getAttributes('<img src="a.png" width="50%" />').width).toBe('');
        expect(getAttributes('<img src="a.png" width="150%" />').width).toBe('');
        expect(getAttributes('<img src="a.png" width="abc" />').width).toBe('');
        expect(getAttributes('<img src="a.png" width="400" height="300" />')).toMatchObject({
            width: '400',
            height: '300',
        });
    });

    it('keeps non-img tags restricted to non-negative integer widths', () => {
        expect(getAttributes('<video src="clip.mp4" width="100%"></video>').width).toBe('');
        expect(getAttributes('<iframe src="https://example.com" width="100%"></iframe>').width).toBe('');
        expect(getAttributes('<canvas width="100%"></canvas>').width).toBe('');
        expect(getAttributes('<video src="clip.mp4" width="640"></video>').width).toBe('640');
    });
});
