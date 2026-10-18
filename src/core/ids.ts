let counter = 0;
const session = Math.random().toString(36).slice(2, 6);

export const createId = (prefix: string): string => `${prefix}_${session}${(counter++).toString(36)}`;
