// 路面验收的场景。每类一组变体，覆盖这一类的各个方向；focus 是样张裁剪的中心格。

const c = 6;
const row = (y, from = 1, to = 11) => [
  [from, y],
  [to, y],
];
const column = (x, from = 1, to = 11) => [
  [x, from],
  [x, to],
];
const riverRows = [4, 5, 6].flatMap((y) => [...Array(12).keys()].map((x) => y * 12 + x));
const QUADRANTS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const CASES = [
  {
    name: '直路',
    focus: [6, 6],
    variants: [
      { N: 12, draw: (w) => w('road', row(c)) },
      { N: 12, draw: (w) => w('road', column(c)) },
    ],
  },
  {
    name: '斜直路',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [2, 2],
            [10, 10],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [2, 10],
            [10, 2],
          ]),
      },
    ],
  },
  {
    name: '直转 45°',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, c],
            [c, c],
            [c + 4, c + 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, c],
            [c, c],
            [c + 4, c - 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [11, c],
            [c, c],
            [c - 4, c + 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [11, c],
            [c, c],
            [c - 4, c - 4],
          ]),
      },
    ],
  },
  {
    name: '45° 转直',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [c, 1],
            [c, c],
            [c + 4, c + 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [c, 1],
            [c, c],
            [c - 4, c + 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [c, 11],
            [c, c],
            [c + 4, c - 4],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [c, 11],
            [c, c],
            [c - 4, c - 4],
          ]),
      },
    ],
  },
  {
    name: '直角转弯',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, c],
            [c, c],
            [c, 11],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [11, c],
            [c, c],
            [c, 11],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, c],
            [c, c],
            [c, 1],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [11, c],
            [c, c],
            [c, 1],
          ]),
      },
    ],
  },
  {
    name: 'T 字路口',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', [
            [c, c],
            [c, 11],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', [
            [c, c],
            [c, 1],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', column(c));
          w('road', [
            [c, c],
            [11, c],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', column(c));
          w('road', [
            [c, c],
            [1, c],
          ]);
        },
      },
    ],
  },
  {
    name: '十字路口',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', column(c));
        },
      },
    ],
  },
  {
    name: '直路接 45°（T）',
    focus: [6, 6],
    variants: [
      ...QUADRANTS.map(([dx, dy]) => ({
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', [
            [c, c],
            [c + dx * 4, c + dy * 4],
          ]);
        },
      })),
      ...QUADRANTS.map(([dx, dy]) => ({
        N: 12,
        draw: (w) => {
          w('road', column(c));
          w('road', [
            [c, c],
            [c + dx * 4, c + dy * 4],
          ]);
        },
      })),
    ],
  },
  {
    name: '直斜交叉',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', [
            [2, 2],
            [10, 10],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', [
            [2, 10],
            [10, 2],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', column(c));
          w('road', [
            [2, 2],
            [10, 10],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', column(c));
          w('road', [
            [2, 10],
            [10, 2],
          ]);
        },
      },
    ],
  },
  {
    name: '六向路口',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) => {
          w('road', row(c));
          w('road', column(c));
          w('road', [
            [2, 2],
            [10, 10],
          ]);
        },
      },
    ],
  },
  {
    name: '连续 S 弯',
    focus: [5, 5],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, 3],
            [3, 3],
            [6, 6],
            [8, 6],
            [10, 8],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [1, 3],
            [2, 3],
            [3, 4],
            [4, 4],
            [5, 5],
            [6, 5],
            [7, 6],
            [8, 6],
            [9, 7],
          ]),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [3, 1],
            [3, 2],
            [4, 3],
            [4, 4],
            [5, 5],
            [5, 6],
            [6, 7],
            [6, 8],
            [7, 9],
          ]),
      },
    ],
  },
  {
    name: '桥头',
    focus: [6, 3],
    variants: [
      { N: 12, draw: (w) => w('road', column(c)), water: riverRows },
      { N: 12, draw: (w) => w('highway', column(c)), water: riverRows },
    ],
  },
  {
    name: '坡道接平地',
    focus: [6, 5],
    sheetVariant: 2,
    variants: [
      { N: 12, draw: (w) => w('road', row(c)), heights: (x) => Math.max(0, Math.min(3, x - 3)) },
      {
        N: 12,
        draw: (w) => w('road', column(c)),
        heights: (x, y) => Math.max(0, Math.min(3, 7 - y)),
      },
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [2, 9],
            [9, 2],
          ]),
        heights: (x, y) => Math.max(0, Math.min(3, 8 - y)),
      },
    ],
  },
  {
    name: '高速',
    focus: [6, 3],
    sheetVariant: 1,
    variants: [
      { N: 12, draw: (w) => w('highway', row(c)) },
      {
        N: 12,
        draw: (w) =>
          w('highway', [
            [1, 2],
            [4, 2],
            [8, 6],
            [8, 11],
          ]),
      },
    ],
  },
  {
    name: '双向四车道',
    focus: [6, 6],
    sheetVariant: 2,
    variants: [
      { N: 12, draw: (w) => w('arterial', row(c)) },
      {
        N: 12,
        draw: (w) =>
          w('arterial', [
            [1, c],
            [c, c],
            [c + 4, c + 4],
          ]),
      },
      {
        N: 12,
        draw: (w) => {
          w('arterial', row(c));
          w('arterial', column(c));
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('arterial', row(c));
          w('road', column(c));
        },
      },
    ],
  },
  {
    name: '四车道接两车道',
    focus: [6, 6],
    variants: [
      {
        N: 12,
        draw: (w) => {
          w('arterial', [
            [1, c],
            [c, c],
          ]);
          w('road', [
            [c, c],
            [11, c],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('road', [
            [1, c],
            [c, c],
          ]);
          w('arterial', [
            [c, c],
            [11, c],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('arterial', [
            [c, 1],
            [c, c],
          ]);
          w('road', [
            [c, c],
            [c, 11],
          ]);
        },
      },
      {
        N: 12,
        draw: (w) => {
          w('arterial', [
            [2, 2],
            [c, c],
          ]);
          w('road', [
            [c, c],
            [10, 10],
          ]);
        },
      },
    ],
  },
  {
    name: '边界未打通·普通路',
    focus: [8, 11],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('road', [
            [8, 3],
            [8, 11],
          ]),
        gates: [{ x: 8, y: 11, kind: 'road', inward: 6, axis: 'z' }],
      },
    ],
  },
  {
    name: '边界未打通·高速',
    focus: [11, 8],
    variants: [
      {
        N: 12,
        draw: (w) =>
          w('highway', [
            [3, 8],
            [11, 8],
          ]),
        gates: [{ x: 11, y: 8, kind: 'highway', inward: 4, axis: 'x' }],
      },
    ],
  },
  {
    name: '边界已打通·普通路',
    focus: [8, 12],
    variants: [
      {
        N: 12,
        linked: true,
        draw: (w) =>
          w('road', [
            [8, 3],
            [8, 11],
          ]),
        gates: [{ x: 8, y: 11, kind: 'road', inward: 6, axis: 'z' }],
      },
    ],
  },
  {
    name: '边界已打通·高速',
    focus: [12, 8],
    variants: [
      {
        N: 12,
        linked: true,
        draw: (w) =>
          w('highway', [
            [3, 8],
            [11, 8],
          ]),
        gates: [{ x: 11, y: 8, kind: 'highway', inward: 4, axis: 'x' }],
      },
    ],
  },
];
