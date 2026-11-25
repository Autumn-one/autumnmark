// Unicode-aware like GitHub, so CJK and accented headings keep an anchor (#5292).
export function generateGithubSlug(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

export function uniqueHeadingSlug(text: string, seen: Set<string>): string {
    const base = generateGithubSlug(text) || 'heading';
    let slug = base;
    let suffix = 1;
    while (seen.has(slug))
        slug = `${base}-${suffix++}`;
    seen.add(slug);
    return slug;
}
