const STORAGE_KEY = "friends-printer-app-v5";
const SESSION_KEY = "friends-printer-session-v1";
const USERS_KEY = "friends-printer-users-v1";
const PLA_COST_PER_KG = 60;
const IMAGE_SEED_VERSION = 3;

const demoUsers = [
  {
    id: "admin",
    name: "אמיר",
    role: "admin",
    password: "1236",
  },
  {
    id: "daniel",
    name: "דניאל",
    role: "friend",
    password: "1234",
  },
  {
    id: "noa",
    name: "נועה",
    role: "friend",
    password: "1234",
  },
  {
    id: "neomi",
    name: "נעמיקי",
    role: "friend",
    password: "1234",
  },
];

const productImagesByStlUrl = {
  "https://www.thingiverse.com/thing:3598949": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f1/dd/82/9f/97/Key_Tray_2019-Apr-30_08-46-29PM-000_CustomizedView18435398591.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6309491": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/98/76/ba/5b/ad/a0d89ce3-2a7a-4ce6-bf0d-48ddec0eed44.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3347414": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f6/42/99/2e/10/02.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:644491": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/93/f5/9a/e3/6d/P1060532.JPG&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5898290": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/7a/0e/8f/57/44/109d18de-2416-4626-9d80-ec888068dd4c.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6935945": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/71/8e/aa/df/97/remotes_mount.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:37960": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/e6/e3/bd/2a/75/cable_clips_x_3.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6155858": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/d9/81/17/c9/b8/d204dc84-a7fa-4399-a719-5a3a613bc48d.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2050885": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/fd/20/9e/68/4f/MakerBot_headphone_Stand_Render.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3827538": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/3c/50/85/f7/70/IMG_9756.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:1187364": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/de/72/96/07/c2/SpongeHolder4.JPG&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6763116": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/e5/5f/1a/05/37/9bac5fc7-12c1-4f8d-9795-b7cf26645c36.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:330151": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/2b/a9/56/2d/4e/bagClip_2.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3058310": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f1/62/7b/d9/21/MVIMG_20180820_125633.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:80106": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/01/5e/7a/e7/66/IMG_1969.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:1891584": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/8c/50/8c/51/95/low_poly_spoon_rest_3dprintny.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2850883": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/68/76/98/98/de/IMG_20180405_111259.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:1596322": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a2/d0/89/f6/e6/IMG_7235.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:725952": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/08/1c/af/1c/46/BAG_DISPENCER-1.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:7190665": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a5/0a/c4/a7/70/Universal_towel_hook.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5151237": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/be/19/9a/d5/e0/3.JPG&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:867811": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/05/99/2c/c4/62/Toothpaste_Squeezer.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6516633": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/80/5e/84/a6/7c/30a907e5-af74-4942-b55c-5c07928d5a07.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:662714": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4f/d1/65/af/f0/shaver_holder00.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6875435": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/d7/2a/86/6d/e8/IMG_4418.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5740323": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/8b/96/19/a3/c7/90e888c5-dfd7-43af-ba03-32e71dcb19b9.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:37283": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/b3/6b/59/ca/75/DSC_0077.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2637487": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c6/7f/b5/e1/aa/USB_01.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:73489": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/bc/e4/fd/b4/36/IMG_5710.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6426072": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c8/2b/80/f0/19/779e4488-8d1f-4306-bced-6d926e2049d5.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:923111": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/0f/9d/96/fb/58/IMG_3210.JPG&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3898441": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/de/f5/05/1a/0a/jewelryHolderV2.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5902365": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a3/71/65/f1/af/ebb451f9-bd4b-4d1c-884a-f3f316946627.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6791127": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/43/bb/d5/1c/36/IMG_2380.JPG_compressed.JPEG&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6813328": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/cd/d5/82/20/1a/Label_12.5_50_30.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5371231": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/38/41/18/18/f7/1651154882116111.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2545456": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/68/06/b3/62/6c/20170920_171340.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3719476": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/e6/81/4a/e9/b7/hrbh.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:1775488": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/3e/ec/a8/e6/fb/20161119_135005.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:98825": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/69/6f/77/d2/bb/photo_3.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:4740308": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/be/9f/f1/41/d6/030d2078-2540-47a5-a9ae-4938c521c7c5.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:3675279": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/45/ae/03/5c/ac/20190606_181915.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2805978": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/19/ce/fd/5a/62/thingverse.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:5958301": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/5d/d8/34/01/f3/0816ca48-5e8d-4477-8d78-2592f2617f92.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:2858696": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/28/53/42/18/a1/Seed_Storage_Box_01.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:7145404": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4d/b0/57/e2/23/5.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:4782296": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/08/d0/1c/43/ba/Stroller_Hook.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:4910958": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/af/81/52/90/94/Cupholder_-_Right.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6420289": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f5/bc/de/e8/f3/3a20cafd-13aa-4b34-a60c-35a908a887fa.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:7047129": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/1d/84/b4/c6/a8/20250525_152314.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6628547": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c4/4c/27/f1/49/9048d767-a7c3-4588-94a6-52f8682bcdd5.png&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6998597": "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c4/d6/81/2f/0e/mam.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1",
};

const demoProducts = [
  {
    id: crypto.randomUUID(),
    name: "מחזיק מפתחות לקיר",
    cost: 3.3,
    grams: 55,
    description: "מתלה קיר עם ווים ומדף קטן למפתחות/פריטים קטנים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3598949",
  },
  {
    id: crypto.randomUUID(),
    name: "קופסת כניסה לבית",
    cost: 9.6,
    grams: 160,
    description: "מגש catch-all לארנק, מפתחות, שעון ומטבעות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6309491",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לטלפון",
    cost: 2.7,
    grams: 45,
    description: "סטנד שולחני פשוט לטלפון בזווית צפייה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3347414",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק משקפיים",
    cost: 2.4,
    grams: 40,
    description: "מעמד קטן למשקפיים לשידה/שולחן.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:644491",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק שלט מזגן",
    cost: 2.7,
    grams: 45,
    description: "תושבת קיר לשלט מזגן/טלוויזיה יחיד.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5898290",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית שלטים",
    cost: 8.1,
    grams: 135,
    description: "מעמד קיר לשני שלטים או יותר.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6935945",
  },
  {
    id: crypto.randomUUID(),
    name: "קליפס כבלים לשולחן",
    cost: 0.48,
    grams: 8,
    description: "תופסן קטן שמונע מכבלי טעינה ליפול מהשולחן.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:37960",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית כבלים",
    cost: 4.2,
    grams: 70,
    description: "פתרון לניהול כבלים מתחת לשולחן/עמדת עבודה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6155858",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לאוזניות",
    cost: 6.3,
    grams: 105,
    description: "סטנד שולחני לאוזניות, מתאים לעמדת מחשב.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2050885",
  },
  {
    id: crypto.randomUUID(),
    name: "מפרידי מגירה מודולריים",
    cost: 7.2,
    grams: 120,
    description: "מערכת מחיצות מודולרית לסידור מגירות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3827538",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק ספוג לכיור",
    cost: 2.28,
    grams: 38,
    description: "מעמד קטן לספוג/סקוץ׳ עם ניקוז.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:1187364",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לסבון כלים וסקוץ׳",
    cost: 6.9,
    grams: 115,
    description: "ארגונית לכיור עבור סבון, ספוג ומברשת.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6763116",
  },
  {
    id: crypto.randomUUID(),
    name: "קליפסים לשקיות אוכל",
    cost: 0.72,
    grams: 12,
    description: "קליפסים לסגירת שקיות מזון; הדפסה קטנה ומהירה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:330151",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית תבלינים",
    cost: 12.6,
    grams: 210,
    description: "מדף/ארגונית לתבלינים במטבח.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3058310",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק קפסולות קפה",
    cost: 10.2,
    grams: 170,
    description: "מסילה/מעמד לקפסולות נספרסו.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:80106",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לכף בישול",
    cost: 2.7,
    grams: 45,
    description: "מגש לשמירה על משטח נקי בזמן בישול.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:1891584",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק מכסה סיר",
    cost: 4.5,
    grams: 75,
    description: "תושבת/מתלה למכסה סיר במטבח.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2850883",
  },
  {
    id: crypto.randomUUID(),
    name: "משפך קטן",
    cost: 1.44,
    grams: 24,
    description: "משפך מטבח בסיסי להעברת נוזלים/תבלינים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:1596322",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק שקיות ניילון",
    cost: 10.8,
    grams: 180,
    description: "דיספנסר לאחסון ושליפה של שקיות ניילון.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:725952",
  },
  {
    id: crypto.randomUUID(),
    name: "מתלה מגבת מטבח",
    cost: 2.1,
    grams: 35,
    description: "וו לדלת ארון/מגירה עבור מגבת מטבח.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:7190665",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק מברשות שיניים",
    cost: 4.2,
    grams: 70,
    description: "מעמד למברשות שיניים ומשחת שיניים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5151237",
  },
  {
    id: crypto.randomUUID(),
    name: "סוחט משחת שיניים",
    cost: 0.96,
    grams: 16,
    description: "כלי קטן לגלגול/סחיטת שפופרת משחת שיניים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:867811",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק סבון עם ניקוז",
    cost: 3,
    grams: 50,
    description: "מגש סבון עם ניקוז למניעת הצטברות מים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6516633",
  },
  {
    id: crypto.randomUUID(),
    name: "מתלה לסכין גילוח",
    cost: 1.08,
    grams: 18,
    description: "מחזיק קטן לסכין גילוח במקלחת/אמבטיה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:662714",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית איפור / קרמים",
    cost: 12.6,
    grams: 210,
    description: "ארגונית מחולקת לאיפור, קרמים ומברשות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6875435",
  },
  {
    id: crypto.randomUUID(),
    name: "סטנד ללפטופ",
    cost: 18,
    grams: 300,
    description: "סטנד נייד/מתקפל ללפטופ לשיפור זווית עבודה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5740323",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לטאבלט",
    cost: 7.5,
    grams: 125,
    description: "מעמד מתכוונן לטאבלט או טלפון גדול.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:37283",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק USB / כרטיסי זיכרון",
    cost: 3.3,
    grams: 55,
    description: "ארגונית ל־USB, SD ו־MicroSD.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2637487",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד עטים",
    cost: 6.6,
    grams: 110,
    description: "כוס/מעמד לעטים, עפרונות וכלי כתיבה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:73489",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד לספר לימוד",
    cost: 11.4,
    grams: 190,
    description: "סטנד מתקפל/יציב לספר לימוד או ספר מתכונים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6426072",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק חגורות",
    cost: 5.7,
    grams: 95,
    description: "מתלה לחגורות בארון.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:923111",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק תכשיטים",
    cost: 6.9,
    grams: 115,
    description: "סטנד/ארגונית לתכשיטים, טבעות ושרשראות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3898441",
  },
  {
    id: crypto.randomUUID(),
    name: "קליפסים לגרביים בכביסה",
    cost: 0.84,
    grams: 14,
    description: "קליפסים לשמירת זוגות גרביים בזמן כביסה/ייבוש.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5902365",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק נעליים בזווית",
    cost: 10.8,
    grams: 180,
    description: "מודול לאחסון נעליים/הגדלת מקום במדף.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6791127",
  },
  {
    id: crypto.randomUUID(),
    name: "תוויות למדפים בארון",
    cost: 0.48,
    grams: 8,
    description: "מחזיק תגית/תווית למדף, קופסה או מגירה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6813328",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק טלפון לרכב",
    cost: 5.1,
    grams: 85,
    description: "מחזיק טלפון אוניברסלי לרכב.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5371231",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק משקפי שמש לרכב",
    cost: 1.44,
    grams: 24,
    description: "קליפס למגן שמש עבור משקפי שמש.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2545456",
  },
  {
    id: crypto.randomUUID(),
    name: "וו לשקיות בגב מושב",
    cost: 2.1,
    grams: 35,
    description: "וו לתליית שקיות קניות/תיק על משענת ראש ברכב.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3719476",
  },
  {
    id: crypto.randomUUID(),
    name: "מתקן שקית אשפה לרכב",
    cost: 6.3,
    grams: 105,
    description: "מחזיק/מסגרת לשקית אשפה קטנה ברכב.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:1775488",
  },
  {
    id: crypto.randomUUID(),
    name: "קופסה למטבעות ברכב",
    cost: 3.3,
    grams: 55,
    description: "ארגונית מטבעות לכוס/קונסולה ברכב.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:98825",
  },
  {
    id: crypto.randomUUID(),
    name: "תוויות לעציצים",
    cost: 0.48,
    grams: 8,
    description: "תגיות/שלטים לצמחים ולערוגות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:4740308",
  },
  {
    id: crypto.randomUUID(),
    name: "תופסן לצמחים מטפסים",
    cost: 0.3,
    grams: 5,
    description: "קליפס תמיכה לצמח וגבעול/מקל במבוק.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:3675279",
  },
  {
    id: crypto.randomUUID(),
    name: "מתאם טפטוף לבקבוק",
    cost: 1.5,
    grams: 25,
    description: "מתאם השקיה איטית לבקבוק PET/סודה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2805978",
  },
  {
    id: crypto.randomUUID(),
    name: "תחתית לעציץ",
    cost: 7.2,
    grams: 120,
    description: "צלחת ניקוז לעציץ במספר גדלים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:5958301",
  },
  {
    id: crypto.randomUUID(),
    name: "קופסה לזרעים",
    cost: 8.1,
    grams: 135,
    description: "קופסת אחסון לזרעים עם מכסה/אוורור.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:2858696",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק מוצץ",
    cost: 2.1,
    grams: 35,
    description: "ארגונית/מעמד למוצצים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:7145404",
  },
  {
    id: crypto.randomUUID(),
    name: "וו לעגלה",
    cost: 3.3,
    grams: 55,
    description: "וו לתליית תיק/שקית על עגלת תינוק.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:4782296",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק בקבוק לעגלה",
    cost: 7.8,
    grams: 130,
    description: "מחזיק כוס/בקבוק לעגלה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:4910958",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית לשידת החתלה",
    cost: 18,
    grams: 300,
    description: "מחזיק חיתולים וציוד בסיסי לשידת החתלה.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6420289",
  },
  {
    id: crypto.randomUUID(),
    name: "מגן פינות לשולחן",
    cost: 1.08,
    grams: 18,
    description: "מגיני פינות לתינוקות/רהיטים, עדיף TPU.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:7047129",
  },
  {
    id: crypto.randomUUID(),
    name: "תוויות בגדי תינוק לפי מידה",
    cost: 0.48,
    grams: 8,
    description: "מחיצות לארון בגדי תינוק לפי חודשים/מידות.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6628547",
  },
  {
    id: crypto.randomUUID(),
    name: "מעמד ייבוש בקבוקים",
    cost: 14.4,
    grams: 240,
    description: "מתקן לייבוש בקבוקי תינוק וחלקים קטנים.",
    image: "",
    stlUrl: "https://www.thingiverse.com/thing:6998597",
  },
];

const demoOrders = [
  {
    id: crypto.randomUUID(),
    productId: demoProducts[0].id,
    friendName: "דניאל",
    quantity: 1,
    price: 25,
    status: "ready",
    paid: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    productId: demoProducts[2].id,
    friendName: "נועה",
    quantity: 2,
    price: 60,
    status: "printing",
    paid: false,
    createdAt: new Date().toISOString(),
  },
];

const statusLabels = {
  new: "חדש",
  printing: "בהדפסה",
  ready: "מוכן",
  delivered: "נמסר",
};

let registeredUsers = loadRegisteredUsers();
let state = normalizeState(loadState());
let currentUser = loadSession();
let appMode = currentUser?.role === "admin" ? "admin" : "friend";
const pageName = document.body.dataset.page || "app";

saveState();

const loginForm = document.querySelector("#login-form");
const loginName = document.querySelector("#login-name");
const loginError = document.querySelector("#login-error");
const registerForm = document.querySelector("#register-form");
const registerError = document.querySelector("#register-error");
const authModeButtons = document.querySelectorAll(".auth-mode-button");
const catalogGrid = document.querySelector("#catalog-grid");
const cardTemplate = document.querySelector("#product-card-template");
const orderDialog = document.querySelector("#order-dialog");
const orderForm = document.querySelector("#order-form");
const ordersTable = document.querySelector("#orders-table");
const debtGrid = document.querySelector("#debt-grid");
const productForm = document.querySelector("#product-form");
const productsTable = document.querySelector("#products-table");
const aiProductIdea = document.querySelector("#ai-product-idea");

authModeButtons.forEach((button) => {
  button.addEventListener("click", () => setAuthPanel(button.dataset.authTarget));
});

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const typedName = String(data.get("loginName") ?? "").trim();
  const user = getUsers().find((appUser) => appUser.name === typedName);

  if (!user || user.password !== data.get("password")) {
    loginError.textContent = "שם המשתמש או הסיסמה לא נכונים.";
    loginError.classList.add("is-visible");
    return;
  }

  loginError.classList.remove("is-visible");
  loginForm.reset();
  currentUser = {
    id: user.id,
    name: user.name,
    role: user.role,
  };
  appMode = currentUser.role === "admin" ? "admin" : "friend";
  saveSession();

  if (currentUser.role === "friend") {
    window.location.href = "welcome.html";
    return;
  }

  document.body.dataset.entry = "app";
  applyAuth();
  applyMode();
  setView(appMode === "admin" ? "product-list" : "catalog");
  render();
});

registerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(registerForm);
  const name = data.get("name").trim();
  const password = data.get("password");
  const confirmPassword = data.get("confirmPassword");

  if (name.length < 2) {
    showRegisterError("שם צריך להיות לפחות שני תווים, בכל זאת אנחנו לא מדפיסים משתמש בלי שם.");
    return;
  }

  if (password.length < 4) {
    showRegisterError("הסיסמה צריכה להיות לפחות 4 תווים.");
    return;
  }

  if (password !== confirmPassword) {
    showRegisterError("הסיסמאות לא תואמות.");
    return;
  }

  if (getUsers().some((user) => user.name.trim() === name)) {
    showRegisterError("כבר יש משתמש בשם הזה. נסה שם קצת יותר ספציפי.");
    return;
  }

  const user = {
    id: `friend-${crypto.randomUUID()}`,
    name,
    role: "friend",
    password,
  };

  registeredUsers.push(user);
  saveRegisteredUsers();
  currentUser = {
    id: user.id,
    name: user.name,
    role: user.role,
  };
  appMode = "friend";
  registerError.classList.remove("is-visible");
  registerForm.reset();
  saveSession();
  window.location.href = "welcome.html";
});

document.querySelector("#logout-button")?.addEventListener("click", () => {
  if (orderDialog?.open) {
    orderDialog.close();
  }
  currentUser = null;
  appMode = "friend";
  localStorage.removeItem(SESSION_KEY);
  document.body.dataset.entry = pageName === "app" ? "login" : "landing";
  applyAuth();
  setView("landing");

  if (pageName !== "app") {
    window.location.href = "index.html";
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

document.querySelector("#reset-demo")?.addEventListener("click", () => {
  state = normalizeState(createDemoState());
  saveState();
  render();
});

document.querySelector(".close-button")?.addEventListener("click", () => orderDialog.close());
document.querySelector("#cancel-order")?.addEventListener("click", () => orderDialog.close());

document.querySelector("#ai-draft-button")?.addEventListener("click", () => {
  const draft = createAiProductDraft(aiProductIdea.value);
  productForm.elements["name"].value = draft.name;
  productForm.elements["cost"].value = draft.cost;
  productForm.elements["grams"].value = draft.grams;
  productForm.elements["description"].value = draft.description;
  productForm.elements["image"].value = draft.image;
  productForm.elements["stlUrl"].value = draft.stlUrl;
});

productForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(productForm);
  const product = {
    id: crypto.randomUUID(),
    name: data.get("name").trim(),
    cost: normalizeProductCost(data.get("cost")),
    grams: normalizeProductGrams(data.get("grams")),
    description: data.get("description").trim(),
    image: normalizeProductImage(data.get("image").trim()),
    stlUrl: data.get("stlUrl").trim(),
  };

  state.products.push(product);
  productForm.reset();
  saveState();
  render();
  setView("product-list");
});

orderForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(orderForm);
  const product = findProduct(data.get("productId"));
  if (!product) return;

  const quantity = Number(data.get("quantity"));
  const price = Number(data.get("price"));
  const minimum = product.cost * quantity;

  if (price < minimum) {
    orderForm.price.setCustomValidity(`המינימום להזמנה הזו הוא ${formatCurrency(minimum)}`);
    orderForm.reportValidity();
    return;
  }

  orderForm.price.setCustomValidity("");
  state.orders.unshift({
    id: crypto.randomUUID(),
    productId: product.id,
    friendName: getOrderFriendName(data),
    quantity,
    price,
    status: "new",
    paid: false,
    createdAt: new Date().toISOString(),
  });

  saveState();
  render();
  orderDialog.close();
  setView(appMode === "admin" ? "orders" : "catalog");
});

orderForm?.quantity?.addEventListener("input", updateOrderMinimum);

function createDemoState() {
  return {
    products: structuredClone(demoProducts),
    orders: structuredClone(demoOrders),
    imagesCleared: true,
    imagesSeeded: false,
    imageSeedVersion: 0,
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDemoState();

  try {
    const parsedState = JSON.parse(saved);
    if (!Array.isArray(parsedState.products) || !Array.isArray(parsedState.orders)) {
      return createDemoState();
    }
    return parsedState;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return createDemoState();
  }
}

function normalizeState(stateToNormalize) {
  const shouldClearImages = !stateToNormalize.imagesCleared;
  const shouldSeedImages = stateToNormalize.imageSeedVersion !== IMAGE_SEED_VERSION;

  return {
    ...stateToNormalize,
    imagesCleared: true,
    imagesSeeded: true,
    imageSeedVersion: IMAGE_SEED_VERSION,
    products: stateToNormalize.products.map((product) => ({
      ...product,
      cost: normalizeProductCost(product.cost),
      image: getNormalizedProductImage(product, shouldClearImages, shouldSeedImages),
      grams: normalizeProductGrams(product.grams),
    })),
    orders: stateToNormalize.orders.map((order) => ({
      ...order,
      quantity: Math.max(Number(order.quantity) || 1, 1),
      price: normalizeProductCost(order.price),
      status: statusLabels[order.status] ? order.status : "new",
      paid: Boolean(order.paid),
      createdAt: order.createdAt || new Date().toISOString(),
    })),
  };
}

function getNormalizedProductImage(product, shouldClearImages, shouldSeedImages) {
  const currentImage = normalizeProductImage(product.image);
  const seedImage = getSeedProductImage(product);

  if ((shouldClearImages || shouldSeedImages || !currentImage) && seedImage) {
    return seedImage;
  }

  return currentImage;
}

function getSeedProductImage(product) {
  return toImageProxyUrl(unwrapThingiverseResizeUrl(productImagesByStlUrl[product.stlUrl] ?? ""));
}

function unwrapThingiverseResizeUrl(imageUrl) {
  if (!imageUrl) return "";

  try {
    const parsedUrl = new URL(imageUrl);
    return parsedUrl.searchParams.get("url") || imageUrl;
  } catch {
    return imageUrl;
  }
}

function toImageProxyUrl(imageUrl) {
  if (!imageUrl) return "";

  try {
    const parsedUrl = new URL(imageUrl);
    const proxiedUrl = `${parsedUrl.hostname}${parsedUrl.pathname}`;
    return `https://images.weserv.nl/?url=${encodeURIComponent(proxiedUrl)}&w=628&h=472&fit=contain&output=webp`;
  } catch {
    return imageUrl;
  }
}

function normalizeProductImage(image) {
  return image?.trim() ?? "";
}

function normalizeProductGrams(grams) {
  return Math.max(Number(grams) || 1, 1);
}

function normalizeProductCost(cost) {
  return Math.max(Number(cost) || 0.01, 0.01);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getUsers() {
  return [...demoUsers, ...registeredUsers];
}

function loadRegisteredUsers() {
  const saved = localStorage.getItem(USERS_KEY);
  if (!saved) return [];

  try {
    const parsedUsers = JSON.parse(saved);
    if (!Array.isArray(parsedUsers)) return [];

    return parsedUsers
      .filter((user) => user?.id && user?.name && user?.password)
      .map((user) => ({
        id: user.id,
        name: user.name,
        role: "friend",
        password: user.password,
      }));
  } catch {
    localStorage.removeItem(USERS_KEY);
    return [];
  }
}

function saveRegisteredUsers() {
  localStorage.setItem(USERS_KEY, JSON.stringify(registeredUsers));
}

function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;

  try {
    const session = JSON.parse(saved);
    return getUsers().some((user) => user.id === session.id && user.role === session.role) ? session : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
}

function setAuthPanel(panelName) {
  document.querySelectorAll(".auth-form").forEach((form) => {
    form.classList.toggle("is-active", form.dataset.authForm === panelName);
  });

  authModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTarget === panelName);
  });

  loginError?.classList.remove("is-visible");
  registerError?.classList.remove("is-visible");
}

function showRegisterError(message) {
  registerError.textContent = message;
  registerError.classList.add("is-visible");
}

function applyAuth() {
  document.body.dataset.auth = currentUser ? "signed-in" : "signed-out";
  document.body.dataset.role = currentUser?.role ?? "friend";
  const currentUserLabel = document.querySelector("#current-user");
  if (currentUserLabel) {
    currentUserLabel.textContent = currentUser ? currentUser.name : currentUserLabel.textContent;
  }
}

function applyMode() {
  if (!currentUser || currentUser.role !== "admin") {
    appMode = "friend";
  }

  document.body.dataset.mode = appMode;

  const catalogTitle = document.querySelector("#catalog-title");
  const catalogDescription = document.querySelector("#catalog-view .section-heading p");
  if (catalogTitle && catalogDescription) {
    if (appMode === "friend") {
      catalogTitle.textContent = "מה אפשר להדפיס?";
      catalogDescription.textContent = "בחר מוצר, כמות וסכום שנראה לך הוגן. המינימום הוא עלות ההדפסה.";
      return;
    }

    catalogTitle.textContent = "קטלוג מוצרים";
    catalogDescription.textContent = "בחר מוצר, כמות וסכום לתשלום. המינימום הוא עלות ההדפסה.";
  }
}

function setView(viewName) {
  if (!document.querySelector(".view")) return;

  const friendViews = ["landing", "catalog"];
  const nextView =
    appMode === "friend"
      ? friendViews.includes(viewName) ? viewName : "landing"
      : friendViews.includes(viewName) ? "product-list" : viewName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === nextView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextView}-view`);
  });
}

function render() {
  renderCatalog();
  renderOrders();
  renderDebts();
  renderProducts();
  renderSummary();
}

function renderCatalog() {
  if (!catalogGrid || !cardTemplate) return;

  catalogGrid.replaceChildren();

  state.products.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    renderProductImage(card.querySelector(".product-image"), product);
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent = product.description;
    card.querySelector(".cost").textContent = `עלות ייצור: ${formatCurrency(product.cost)}`;
    renderStlLink(card, product);
    card.querySelector("button").addEventListener("click", () => openOrderDialog(product.id));
    catalogGrid.append(card);
  });
}

function renderOrders() {
  if (!ordersTable) return;

  ordersTable.replaceChildren();
  document.querySelector("#orders-empty")?.classList.toggle("is-visible", state.orders.length === 0);

  state.orders.forEach((order) => {
    const product = findProduct(order.productId);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(order.friendName)}</td>
      <td>${escapeHtml(product?.name ?? "מוצר שנמחק")}</td>
      <td>${order.quantity}</td>
      <td>${formatCurrency(order.price)}</td>
      <td></td>
      <td></td>
    `;

    const statusSelect = document.createElement("select");
    Object.entries(statusLabels).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = order.status === value;
      statusSelect.append(option);
    });
    statusSelect.addEventListener("change", () => {
      order.status = statusSelect.value;
      saveState();
      render();
    });

    const paidLabel = document.createElement("label");
    paidLabel.className = "paid-toggle";
    paidLabel.innerHTML = `<input type="checkbox" ${order.paid ? "checked" : ""} /> שולם`;
    paidLabel.querySelector("input").addEventListener("change", (event) => {
      order.paid = event.target.checked;
      saveState();
      render();
    });

    row.children[4].append(statusSelect);
    row.children[5].append(paidLabel);
    ordersTable.append(row);
  });
}

function renderDebts() {
  if (!debtGrid) return;

  debtGrid.replaceChildren();
  const debts = state.orders.reduce((totals, order) => {
    if (!order.paid) {
      totals[order.friendName] = (totals[order.friendName] ?? 0) + order.price;
    }
    return totals;
  }, {});

  const entries = Object.entries(debts).sort((a, b) => b[1] - a[1]);
  document.querySelector("#debts-empty")?.classList.toggle("is-visible", entries.length === 0);

  entries.forEach(([friendName, total]) => {
    const card = document.createElement("article");
    card.className = "debt-card";
    card.innerHTML = `<strong>${escapeHtml(friendName)}</strong><span>${formatCurrency(total)}</span>`;
    debtGrid.append(card);
  });
}

function renderProducts() {
  if (!productsTable) return;

  productsTable.replaceChildren();
  document.querySelector("#products-empty")?.classList.toggle("is-visible", state.products.length === 0);

  state.products.forEach((product) => {
    const row = document.createElement("tr");
    row.className = "product-edit-row";

    const imageCell = document.createElement("td");
    const preview = document.createElement("div");
    preview.className = "product-thumb";
    renderProductImage(preview, product);
    imageCell.append(preview);

    const nameCell = document.createElement("td");
    nameCell.append(createEditableInput(product, "name", "text"));

    const orderedCell = document.createElement("td");
    orderedCell.className = "ordered-count";
    orderedCell.textContent = getProductOrderedQuantity(product.id);

    const costCell = document.createElement("td");
    costCell.append(createEditableInput(product, "cost", "number"));

    const gramsCell = document.createElement("td");
    gramsCell.append(createEditableInput(product, "grams", "number"));

    const descriptionCell = document.createElement("td");
    const descriptionInput = document.createElement("textarea");
    descriptionInput.value = product.description;
    descriptionInput.rows = 3;
    descriptionInput.addEventListener("change", () => updateProduct(product.id, { description: descriptionInput.value.trim() }));
    descriptionCell.append(descriptionInput);

    const imageUrlCell = document.createElement("td");
    imageUrlCell.append(createEditableInput(product, "image", "text"));

    const stlCell = document.createElement("td");
    stlCell.append(createEditableInput(product, "stlUrl", "url"));

    const actionsCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-button";
    deleteButton.type = "button";
    deleteButton.textContent = "מחיקה";
    deleteButton.addEventListener("click", () => deleteProduct(product.id));
    actionsCell.append(deleteButton);

    row.append(imageCell, nameCell, orderedCell, costCell, gramsCell, descriptionCell, imageUrlCell, stlCell, actionsCell);
    productsTable.append(row);
  });
}

function renderProductImage(container, product) {
  container.replaceChildren();
  container.classList.toggle("has-image", Boolean(product.image));

  if (!product.image) return;

  const image = document.createElement("img");
  image.src = product.image;
  image.alt = product.name;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  container.append(image);
}

function renderSummary() {
  if (!document.querySelector("#summary-orders") || !document.querySelector("#summary-debt")) return;

  const openOrders = state.orders.filter((order) => !order.paid).length;
  const totalDebt = state.orders.reduce((sum, order) => sum + (order.paid ? 0 : order.price), 0);
  document.querySelector("#summary-orders").textContent = openOrders;
  document.querySelector("#summary-debt").textContent = formatCurrency(totalDebt);
}

function openOrderDialog(productId) {
  const product = findProduct(productId);
  if (!product || !orderForm || !orderDialog) return;
  const friendNameIsKnown = currentUser?.role === "friend";
  const friendNameField = orderForm.friendName.closest(".friend-name-field");

  orderForm.reset();
  orderForm.productId.value = product.id;
  orderForm.friendName.value = friendNameIsKnown ? currentUser.name : "";
  orderForm.friendName.required = !friendNameIsKnown;
  orderForm.friendName.readOnly = friendNameIsKnown;
  if (friendNameField) {
    friendNameField.hidden = friendNameIsKnown;
  }
  orderForm.quantity.value = 1;
  orderForm.price.value = product.cost;
  orderForm.price.min = product.cost;
  document.querySelector("#order-product-name").textContent = product.name;
  document.querySelector("#order-product-description").textContent = product.description;
  updateOrderMinimum();
  orderDialog.showModal();
}

function updateOrderMinimum() {
  if (!orderForm) return;

  const product = findProduct(orderForm.productId.value);
  if (!product) return;
  const quantity = Math.max(Number(orderForm.quantity.value) || 1, 1);
  const minimum = product.cost * quantity;
  orderForm.price.min = minimum;
  if (Number(orderForm.price.value) < minimum) {
    orderForm.price.value = minimum;
  }
  document.querySelector("#minimum-note").textContent = `מינימום להזמנה הזו: ${formatCurrency(minimum)}`;
}

function findProduct(productId) {
  return state.products.find((product) => product.id === productId);
}

function getProductOrderedQuantity(productId) {
  return state.orders.reduce((total, order) => {
    return order.productId === productId ? total + order.quantity : total;
  }, 0);
}

function createEditableInput(product, field, type) {
  const input = document.createElement("input");
  input.type = type;
  input.value = product[field] ?? "";

  if (field === "cost") {
    input.min = 0.01;
    input.step = 0.01;
  }

  if (field === "grams") {
    input.min = 1;
    input.step = 1;
  }

  input.addEventListener("change", () => {
    const value =
      field === "cost"
        ? normalizeProductCost(input.value)
        : field === "grams"
          ? normalizeProductGrams(input.value)
          : normalizeEditableProductValue(field, input.value);
    updateProduct(product.id, { [field]: value });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    }
  });

  return input;
}

function updateProduct(productId, updates) {
  const product = findProduct(productId);
  if (!product) return;

  Object.assign(product, updates);
  saveState();
  render();
}

function normalizeEditableProductValue(field, value) {
  const trimmedValue = value.trim();
  return field === "image" ? normalizeProductImage(trimmedValue) : trimmedValue;
}

function deleteProduct(productId) {
  if (!window.confirm("למחוק את המוצר מהקטלוג?")) return;

  state.products = state.products.filter((product) => product.id !== productId);
  saveState();
  render();
}

function renderStlLink(card, product) {
  const stlLink = card.querySelector(".stl-link");
  if (!product.stlUrl) {
    stlLink.remove();
    return;
  }

  stlLink.href = product.stlUrl;
}

function createAiProductDraft(idea) {
  const trimmedIdea = idea.trim();
  const estimatedWeightGrams = 120;

  return {
    name: trimmedIdea ? `פתרון מודפס - ${trimmedIdea}` : "ארגונית קטנה לבית",
    cost: estimatePlaCost(estimatedWeightGrams),
    grams: estimatedWeightGrams,
    description: trimmedIdea
      ? `מוצר פרקטי בהדפסת PLA עבור ${trimmedIdea}. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`
      : `מוצר קטן ושימושי לבית, מתאים לסידור יומיומי. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`,
    image: "",
    stlUrl: "",
  };
}

function estimatePlaCost(weightGrams) {
  return Math.ceil((weightGrams / 1000) * PLA_COST_PER_KG);
}

function getOrderFriendName(data) {
  return currentUser?.role === "friend" ? currentUser.name : data.get("friendName").trim();
}

function formatCurrency(value) {
  const numericValue = Number(value) || 0;
  const fractionDigits = Number.isInteger(numericValue) ? 0 : 2;

  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numericValue);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

if (["catalog", "welcome"].includes(pageName) && !currentUser) {
  window.location.href = "index.html";
} else if (currentUser?.role === "friend" && pageName === "app") {
  window.location.href = "welcome.html";
} else if (currentUser?.role === "admin" && pageName === "welcome") {
  window.location.href = "index.html";
} else {
  if (currentUser && pageName === "app") {
    document.body.dataset.entry = "app";
  }

  if (pageName === "catalog" && currentUser?.role === "admin") {
    appMode = "friend";
  }

  applyAuth();
  applyMode();
  setView(appMode === "admin" ? "product-list" : "catalog");
  render();
}
