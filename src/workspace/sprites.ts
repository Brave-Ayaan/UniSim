// Rough pixel-art sprites for the objects you can add in EDIT. One character = one pixel.
export const SPRITE_COLORS: Record<string, string> = {
  k: '#1b1f24', w: '#e8e8e8', r: '#e05555', R: '#a83232', b: '#4a7fd4', B: '#2c4f8a', y: '#f2d84b', Y: '#c9a227',
  g: '#5cb85c', G: '#2f7a3a', o: '#f0913a', s: '#b0b8c4', S: '#6e7681', n: '#8b5a2b', N: '#5c3a1a', p: '#ff8fb3',
  c: '#7fd1ff', v: '#9b6bd6', t: '#d9b27a', f: '#ffcf5c', m: '#3a3f47',
};

/** filled pixel circle in one colour, with an optional second-colour marking row */
export function ballSprite(r: number, col: string, mark?: string, markRow = -1): string[] {
  const rows: string[] = [];
  for (let y = -r; y <= r; y++) {
    let s = '';
    for (let x = -r; x <= r; x++) s += x * x + y * y <= r * r + r * 0.6 ? (y === markRow && mark ? mark : col) : '.';
    rows.push(s);
  }
  return rows;
}

export const SPRITES: Record<string, string[]> = {
  // vehicles
  car: ['....rrrrr...', '...rcccrrr..', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', 'rrRRRRRRRRrr', '.kkk....kkk.', '..k......k..'],
  truck: ['bbbbbbbbb...', 'bbbbbbbbbcc.', 'bbbbbbbbbccb', 'bbbbbbbbbbbb', 'BBBBBBBBBBBB', '.kk.kk...kk.', '.kk.kk...kk.'],
  sportscar: ['......yyyy....', '....yyccyyy...', '.yyyyyyyyyyyy.', 'yyyyyyyyyyyyyy', '.kkk......kkk.'],
  bus: ['yyyyyyyyyyyyyy', 'ycycycycycycyy', 'ycycycycycycyy', 'yyyyyyyyyyyyyy', 'YYYYYYYYYYYYYY', '.kk.......kk..'],
  motorbike: ['....kk...', '...rrrk..', '.rrrrrr..', 'kk.ss..kk', 'kk.....kk'],
  // rockets & space
  saturnv: ['..w..', '.www.', '.wkw.', '.www.', '.www.', 'wwwww', 'wkkkw', 'wwwww', 'wwwww', 'wwwww', 'wkkkw', 'wwwww', 'wwwww', 'kwkwk', '.ooo.'],
  falcon9: ['.w.', 'www', 'www', 'www', 'wkw', 'www', 'www', 'www', 'www', 'www', 'kkk', '.o.'],
  v2: ['.k.', 'kwk', 'wkw', 'kwk', 'wkw', 'kwk', 'kwk', 'kok'],
  modelrocket: ['.r.', 'rrr', 'www', 'www', 'rwr', '.o.'],
  earth: ['..bbbb..', '.bbggbb.', 'bggbbbbb', 'bbbbggbb', 'bgggbbbb', 'bbbbbgbb', '.bbggbb.', '..bbbb..'],
  moon: ballSprite(2, 's', 'S', 0),
  sun: ['..yyyy..', '.yyffyy.', 'yyffffyy', 'yffffffy', 'yffffffy', 'yyffffyy', '.yyffyy.', '..yyyy..'],
  mars: ballSprite(3, 'o', 'R', 1),
  jupiter: ['..tttt..', '.nnnnnn.', 'tttttttt', 'nnnrnnnn', 'tttttttt', 'nnnnnnnn', '.tttttt.', '..tttt..'],
  iss: ['bb.s.bb', 'bbsssbb', 'bb.s.bb'],
  // balls
  cannonball: ballSprite(2, 'S', 's', -1),
  baseball: ['.www.', 'wrwrw', 'wwwww', 'wrwrw', '.www.'],
  golfball: ballSprite(1, 'w'),
  basketball: ['.ooo.', 'okoko', 'kkkkk', 'okoko', '.ooo.'],
  shotput: ballSprite(2, 'S'),
  bowling: ['.BBB.', 'BBkBB', 'BkBkB', 'BBBBB', '.BBB.'],
  billiard: ['.rrr.', 'rwwwr', 'rwkwr', 'rwwwr', '.rrr.'],
  tennis: ['.yyy.', 'ygyyy', 'yyyyy', 'yyygy', '.yyy.'],
  soccer: ['.www.', 'wkwkw', 'wwkww', 'wkwkw', '.www.'],
  steelball: ballSprite(2, 's', 'w', -1),
  wreckingball: ['..k..', '..k..', '.kkk.', 'kkkkk', 'kkSkk', 'kkkkk', '.kkk.'],
  clockpendulum: ['.n.', '.n.', '.n.', 'yyy', 'yYy', 'yyy'],
  swing: ['n...n', 'n...n', 'n...n', 'NNNNN', '.r.r.'],
  // structures
  footbridge: ['k.k.k.k.k.k', '.k.k.k.k.k.', 'nnnnnnnnnnn'],
  railbridge: ['SSSSSSSSSSSSS', 'S.S.S.S.S.S.S', 'SS.SS.SS.SS.S', 'SSSSSSSSSSSSS', 'kkkkkkkkkkkkk'],
  rooftruss: ['.....n.....', '...nnnnn...', '.nn.n.n.nn.', 'nnnnnnnnnnn'],
  divingboard: ['wwwwwwwww', 'S........', 'S........'],
  shelf: ['nnnnnnnn', 'k......k'],
  joist: ['tttttttttt', 'tttttttttt'],
  ibeam: ['SSSSSSSS', '...SS...', '...SS...', 'SSSSSSSS'],
  // electrical
  battery: ['.kk.', 'rrrr', 'rrrr', 'kkkk', 'kkkk'],
  bulb: ['.yyy.', 'yffyy', 'yffyy', '.yyy.', '..s..', '..s..'],
  radio: ['kkkkkk', 'kSScwk', 'kSSkkk', 'kkkkkk'],
  flash: ['kkkkk', 'kwwck', 'kkkkk'],
  charger: ['.ss.', 'kkkk', 'kkkk', '.k..'],
  // air & fluids
  cessna: ['....r....', 'wwwwwwwww', '...www...', '..r.w.r..'],
  glider: ['......w......', 'wwwwwwwwwwwww', '......w......', '.....www.....'],
  raindrop: ['..c..', '.ccc.', 'ccccc', '.ccc.'],
  hailstone: ballSprite(1, 'w'),
  skydiver: ['..o..', 'ooooo', '..o..', '.k.k.'],
  hose: ['gggggg', 'g....g', 'gggg.g', '....cc'],
  watertower: ['.sss.', 'scccs', 'scccs', '.sss.', '.k.k.', 'k...k'],
  boat: ['....w....', '....ww...', '....www..', 'nnnnnnnnn', '.nnnnnnn.'],
  iceberg: ['..ww..', '.wcww.', 'ccccccc', '.cccccc', '..cccc.'],
  // springs & motion
  carspring: ['SSSS', '.S.S', 'S.S.', '.S.S', 'S.S.', 'SSSS'],
  slinky: ['vvvv', 'v..v', 'vvvv', 'v..v', 'vvvv'],
  bungee: ['g', 'G', 'g', 'G', 'k', 'r', 'b'],
  washer: ['wwwww', 'wkkkw', 'wkckw', 'wkkkw', 'wwwww'],
  crate: ['nnnnn', 'nNnNn', 'nnNnn', 'nNnNn', 'nnnnn'],
  sled: ['.rrrr.', 'rrrrrr', 'S....S', '.SSSS.'],
  skateboard: ['pppppp', '.k..k.'],
  tyre: ['.kkk.', 'kSSSk', 'kS.Sk', 'kSSSk', '.kkk.'],
  flywheel: ['.SSS.', 'SS.SS', 'S.k.S', 'SS.SS', '.SSS.'],
  spintop: ['..k..', '.rrr.', 'rrrrr', '.rrr.', '..k..'],
  // waves, light, em
  guitar: ['..nn......', '.nnnn.kkkk', '.nkkn.kkkk', '.nnnn.....', '..nn......'],
  piano: ['wwwwwwww', 'wkwkwwkw', 'wkwkwwkw', 'wwwwwwww'],
  siren: ['.rrr.', 'rrbbr', 'wwwww', 'kk.kk'],
  laser: ['SSSSr', 'SSSS.'],
  electron: ['..c..', '.ccc.', '..c..'],
  drill: ['yyyy...', 'yyyysss', '.kk....', '.kk....'],
  dynamo: ['.SS.', 'SrrS', 'SrrS', '.SS.'],
  mri: ['ssssss', 's....s', 's....s', 'ssssss'],
  magnifier: ['.ccc..', 'c...c.', 'c...c.', '.ccc..', '....n.', '.....n'],
  glasses: ['ccc.ccc', 'c.ckc.c', 'ccc.ccc'],
  cameralens: ['kkkkk', 'kcccS', 'kcccS', 'kkkkk'],
  water: ['cccccccc', 'bcbcbcbc'],
  diamond: ['.ccc.', 'ccccc', '.ccc.', '..c..'],
  // chemistry, materials, rooms, control
  flask: ['.s.', '.s.', 'sgs', 'ggg', 'ggg'],
  tube: ['s', 'v', 'v', 'v'],
  cable: ['SSSSSSSSSS'],
  bracket: ['SSSS', 'S..S', 'SSSS'],
  wingskin: ['ssssssss', 'ss.k.sss', 'ssssssss'],
  sand: ['..t..', '.ttt.', 'ttttt'],
  marbles: ['c.b.g', '.v.r.'],
  gravel: ['S.s.S', '.SsS.', 'sSSsS'],
  hall: ['nnnnnnnnnn', 'n.r.r.r..n', 'n.r.r.r..n', 'nnnnnnnnnn'],
  bathroom: ['wwwww', 'wc..w', 'wwwww'],
  studio: ['kkkkkk', 'kvvvvk', 'kvsvvk', 'kkkkkk'],
  drone: ['s...s', 'kkkkk', '.kk..', 's...s'],
  cruise: ['..rr..', '.rccr.', 'rrrrrr', '.k..k.'],
  thermostat: ['www', 'wrw', 'www'],
  engine: ['SSSS', 'SrrS', 'SSSS', '.kk.'],
  powerplant: ['.S..S', '.S..S', 'SSSSS', 'SSSSS'],
  kettle: ['..k..', '.sss.', 'ssssk', 'sssss'],
  icecube: ['ccc', 'cwc', 'ccc'],
  coffee: ['w.w', 'nnnw', 'nnn.'],
  sandpile: ['...t...', '..ttt..', '.ttttt.', 'ttttttt'],
  speaker: ['mmmmm', 'mSSSm', 'mSkSm', 'mSSSm', 'mSkSm', 'mkkkm', 'mSSSm', 'mmmmm'],
  mic: ['.SSS.', 'SsSsS', '.SSS.', '..m..', '..m..', '.mmm.'],
  foam: ['SmSmS', 'mSmSm', 'SmSmS', 'mSmSm', 'SmSmS'],
  curtain: ['RRRRRR', 'rRrRrR', 'rRrRrR', 'rRrRrR', 'rRrRrR', 'rRrRrR'],
  person: ['.ttt.', '.ttt.', '..b..', 'bbbbb', '..b..', '..b..', '.B.B.', '.B.B.'],
  post: ['nn', 'nn', 'nn', 'nn', 'nn', 'NN'],
  books: ['rrbbgg', 'rrbbgg', 'rrbbgg', 'yyyyyy'],
  brick: ['RRRRRR', 'rrRrrR', 'RRRRRR', 'rRrrRr', 'RRRRRR'],
  stoneblock: ['SSSSSS', 'SsSSsS', 'SSSSSS', 'sSSsSS', 'SSSSSS'],
  element: ['......', 'oRoRoR', 'RoRoRo', 'SSSSSS'],
  rod: ['YYYYYYYYYY', 'yyyyyyyyyy'],
  weight: ['..S..', '.S.S.', 'mmmmm', 'mSSSm', 'mSSSm', 'mmmmm'],
  pithball: ['.ww.', 'wwww', 'wwww', '.ww.'],
  dome: ['.sss.', 'sssss', 'sssss', '..S..', '..S..', '.SSS.'],
  target: ['..rrr..', '.rwwwr.', 'rwrrrwr', 'rwrwrwr', 'rwrrrwr', '.rwwwr.', '..rrr..', '...n...', '..nnn..'],
  trackpt: ['.y.', 'yYy', '.y.', '.S.', '.S.'],
  cart: ['rrrrrr', 'rRRRRr', 'rrrrrr', '.k..k.'],
  deer: ['n...n.', '.n.n..', '..nnn.', '..nNn.', 'nnnnn.', 'n...n.', 'n...n.'],
  barrier: ['SsSsSs', 'SSSSSS', 'SSSSSS', 'SSSSSS'],
  bump: ['.yyy.', 'yYYYy'],
  ramp: ['n.....', 'nn....', 'nnn...', 'nnnn..', 'nnnnn.', 'nnnnnn'],
  football: ['.www.', 'wkwkw', 'wwkww', 'wkwkw', '.www.'],
  fan: ['.s.s.', 's.s.s', '.sks.', 's.s.s', '.s.s.', '..m..', '.mmm.'],
  drain: ['SSSSS', 'Sk.kS', '.SSS.', '..c..', '..c..'],
  barrel: ['.nnn.', 'nNNNn', 'nnnnn', 'nNNNn', 'nnnnn', '.nnn.'],
  pipe: ['SSSSSSS', 'ccccccc', 'SSSSSSS'],
  resistor: ['..n..', 'yrbry', 'yrbry', '..n..'],
  capacitor: ['S...S', 'S...S', 'SS.SS', 'S...S', 'S...S'],
  coil: ['.o.o.o.', 'o.o.o.o', '.o.o.o.'],
  switch: ['....S', '...S.', '..S..', 'kSk..'],
  carbattery: ['.S..S.', 'kkkkkk', 'kmmmmk', 'kmmmmk', 'kkkkkk'],
  socket: ['wwwww', 'wk.kw', 'wwwww', 'w.k.w', 'wwwww'],
  lamp: ['.fff.', 'fyyyf', '.fyf.', '..S..', '.SSS.'],
  mirror: ['ws', 'ws', 'ws', 'ws', 'ws', 'ws'],
  glassblock: ['cccc', 'cwcc', 'cccc', 'cccc', 'cccc'],
  prism: ['..c..', '.ccc.', '.cwc.', 'ccccc'],
  screen: ['ww', 'ww', 'ww', 'ww', 'ww', 'ww', 'SS'],
  candle: ['..o..', '..f..', '.www.', '.www.', '.www.'],
  hotplate: ['SSSSSSS', 'rRrRrRr', 'kkkkkkk'],
  icebath: ['c.....c', 'cwcwcwc', 'ccccccc'],
  train: ['..kk......', 'rrrrrrrrrr', 'rwwrrwwrrr', 'rrrrrrrrrr', '.kk....kk.'],
};

/** draw a sprite with its bottom-centre at (cx, by) in pixel units of size px */
export function drawSprite(g: CanvasRenderingContext2D, rows: string[], cx: number, by: number, px: number, alpha = 1) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  g.globalAlpha = alpha;
  rows.forEach((r, j) => [...r].forEach((ch, i) => {
    const col = SPRITE_COLORS[ch];
    if (!col) return;
    g.fillStyle = col;
    g.fillRect(Math.round(cx + (i - w / 2) * px), Math.round(by + (j - h) * px), Math.ceil(px), Math.ceil(px));
  }));
  g.globalAlpha = 1;
}
