// 街区切法的打分权重，和算法分开放，调参时只改这里。五项的取值都在 0 到 1 之间。
export const WEIGHTS = { size: 0.3, regular: 0.12, cuts: 0.08, even: 0.1, diagonal: 0.4 };
