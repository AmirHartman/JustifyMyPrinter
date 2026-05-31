const STORAGE_KEY = "friends-printer-app-v5";
const SESSION_KEY = "friends-printer-session-v1";
const PLA_COST_PER_KG = 60;

const demoUsers = [
  {
    id: "admin",
    name: "אמיר",
    role: "admin",
    password: "admin123",
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
    id: "maya",
    name: "מאיה",
    role: "friend",
    password: "1234",
  },
];

const ideaCategoryImages = {
  "ארגון וסדר לבית": "assets/products/idea-drawer-organizers.png",
  "נוי וקישוט לבית": "assets/products/idea-planters.png",
  "אנימה ודמויות": "assets/products/idea-anime-figure.png",
  "פתרונות להורים צעירים": "assets/products/stroller-cup-holder.png",
  "רכב ומשרד": "assets/products/idea-car-organizers.png",
  "משחקים ופידג׳טים": "assets/products/idea-game-fidget.png",
};

const sourceImageByUrl = {
  "https://www.printables.com/model/120962-modular-drawer-organizer":
    "https://media.printables.com/media/prints/120962/images/1171952_ee7bbd0e-ed0d-4974-accd-c204c639869b/thumbs/cover/1200x630/jpg/dscn16342-l.jpg",
  "https://www.printables.com/model/181089-customisable-drawer-organizer":
    "https://media.printables.com/media/prints/181089/images/1695472_58e4226d-e18c-4259-b81c-d155893d1018/thumbs/cover/1200x630/jpeg/img_3502.jpg",
  "https://www.printables.com/model/1716448-cute-kawaii-cat-succulent-planter/files":
    "https://media.printables.com/media/prints/00823f1f-dd68-457e-bd58-532a5c2a7609/images/12879102_3185dd14-c903-409f-bf25-ee01a845e982_9572416e-d594-4b1c-812a-00d6f6de4a9b/thumbs/cover/1200x630/png/doniczka-kotek.png",
  "https://www.printables.com/model/1472968-labubu-planter":
    "https://media.printables.com/media/prints/886dab9a-4ac6-4b7d-aceb-90df662cb331/images/11102640_2b76e557-d535-42c5-8cec-5804d357f444_e6020f12-521a-4a38-9aef-4161ec9d1d01/thumbs/cover/1200x630/png/zrzut-ekranu-2025-11-7-o-142302.png",
  "https://www.printables.com/model/440482-chibi-anime-girl":
    "https://media.printables.com/media/prints/440482/images/3640701_1696cbce-2c33-4fa2-8366-b7ff781a9102/thumbs/cover/1200x630/jpg/chibi-cute-girl-final.jpg",
  "https://www.printables.com/model/455254-universal-stroller-hook/collections":
    "https://media.printables.com/media/prints/455254/images/3742727_3dcb23c0-072f-4ef8-8f0a-c609af7a01d1/thumbs/cover/1200x630/png/stroller_hook_01.png",
  "https://www.printables.com/model/119409-bag-hook-for-baby-stroller":
    "https://media.printables.com/media/prints/119409/images/1160364_fda9dbea-02dc-4c5e-b834-a93eadc11347/thumbs/cover/1200x630/jpg/f7306abc0eefbf6e53c16e54500617d5_display_large_11.jpg",
  "https://www.printables.com/model/502049-abc-design-stroller-hood-clip":
    "https://media.printables.com/media/prints/502049/images/4091346_02d0d175-eea8-4b59-8cca-3aeeab87eaba/thumbs/cover/1200x630/jpeg/img_0094.jpg",
  "https://www.printables.com/model/52411-car-seat-gap-organizer/collections":
    "https://media.printables.com/media/prints/52411/images/517732_048410cd-ef65-42e6-a5b1-436993fe7fe0/thumbs/cover/1200x630/jpg/20210117_164122.jpg",
  "https://www.printables.com/model/526739-car-trunk-organizer":
    "https://media.printables.com/media/prints/526739/images/4396739_aa2a864a-26d3-4d1f-87f0-fd0bd98db11b/thumbs/cover/1200x630/jpeg/2934b84a-3b6e-455a-bd00-11f36e1e9f43_1_105_c.jpg",
  "https://www.printables.com/model/598851-trunk-velcro-holders/related":
    "https://media.printables.com/media/prints/598851/images/4768730_c617ce61-6860-467a-b5aa-5f72f1304363_9d22e183-37dd-4807-af2d-44c81794e6c2/thumbs/cover/1200x630/jpg/img_0087.jpg",
  "https://www.printables.com/model/907809-console-organizer":
    "https://media.printables.com/media/prints/907809/images/6940043_a7db92c7-cf9c-483e-914a-9ab3e6247202_f3740503-5e2b-4da0-af0b-14b9d8ce40ad/thumbs/cover/1200x630/jpg/img_3049.jpg",
  "https://www.printables.com/model/679611-board-game-card-holder":
    "https://media.printables.com/media/prints/679611/images/5341876_9f74c666-59f1-4469-b11c-8e78e3bf89da_ee920f09-6c00-421b-a14e-26a783907da4/thumbs/cover/1200x630/jpg/img20231212220852.jpg",
  "https://www.printables.com/model/259724-catan-card-holder":
    "https://media.printables.com/media/prints/259724/images/2322544_6c11c60e-b98f-4dbb-9f00-2b68598af73d/thumbs/cover/1200x630/jpg/catan-card-holder6.jpg",
  "https://www.printables.com/model/724930-deck-holders-collection":
    "https://media.printables.com/media/prints/724930/images/5705239_e6d3b7e6-9858-441a-9bd7-247b103285ce_85e0f0d7-d1d8-407e-824e-c20ff0bf8a09/thumbs/cover/1200x630/jpg/20240119_183653.jpg",
  "https://www.thingiverse.com/thing:6613158":
    "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/71/3f/a9/7b/97/5126fcd5-c325-487b-80b6-25cd37e1b849.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
  "https://www.thingiverse.com/thing:6932353":
    "https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/5e/4e/06/99/de/IMG_0989.jpg&w=628&h=472&fit=contain&cbg=white&n=-1",
};

const demoProducts = [
  {
    id: crypto.randomUUID(),
    name: "קליפסים לסידור כבלים",
    cost: 3,
    description: "סט קליפסים לשולחן או לשידה כדי שהכבלים לא יברחו לרצפה.",
    image: "assets/products/cable-clips.png",
    stlUrl: "https://www.printables.com/search/models?q=cable%20clip",
  },
  {
    id: crypto.randomUUID(),
    name: "מתלה מפתחות ומגש כניסה",
    cost: 8,
    description: "מתלה קטן ליד הדלת למפתחות, משקפי שמש וכרטיסים.",
    image: "assets/products/entry-key-tray.png",
    stlUrl: "https://www.printables.com/search/models?q=key%20holder%20tray",
  },
  {
    id: crypto.randomUUID(),
    name: "מייבש בקבוקים ומוצצים",
    cost: 11,
    description: "מעמד קומפקטי לחלקי בקבוקים ומוצצים. לא מיועד לשימוש בטיחותי או לעומס.",
    image: "assets/products/baby-bottle-rack.png",
    stlUrl: "https://www.printables.com/search/models?q=baby%20bottle%20drying%20rack",
  },
  {
    id: crypto.randomUUID(),
    name: "מחזיק כוס לעגלה",
    cost: 10,
    description: "תוסף קליפס לעגלה לכוס קפה, בקבוק קטן או כוס חטיפים. לא להעמיס משקל כבד.",
    image: "assets/products/stroller-cup-holder.png",
    stlUrl: "https://www.printables.com/search/models?q=stroller%20cup%20holder",
  },
  {
    id: crypto.randomUUID(),
    name: "ארגונית מברשות לחדר רחצה",
    cost: 7,
    description: "מחזיק קיר למברשות שיניים, משחה וסכין גילוח.",
    image: "assets/products/bathroom-organizer.png",
    stlUrl: "https://www.printables.com/search/models?q=toothbrush%20holder",
  },
  {
    id: crypto.randomUUID(),
    name: "מדרגות לתבלינים במגירה",
    cost: 14,
    description: "סט מודולרי שמרים צנצנות תבלינים בזווית כדי למצוא הכול מהר.",
    image: "assets/products/spice-drawer-risers.png",
    stlUrl: "https://www.printables.com/search/models?q=spice%20drawer%20organizer",
  },
  {
    id: crypto.randomUUID(),
    name: "תגיות השקיה לעציצים",
    cost: 3,
    description: "תגיות חמודות לעציצים עם מקום לתזכורת השקיה.",
    image: "assets/products/plant-reminder-tags.png",
    stlUrl: "https://www.printables.com/search/models?q=plant%20tags",
  },
  {
    id: crypto.randomUUID(),
    name: "מגש לערב משחקים",
    cost: 11,
    description: "מגש מחולק לקוביות, קלפים ואסימונים לערב משחקים מסודר.",
    image: "assets/products/game-night-tray.png",
    stlUrl: "https://www.printables.com/search/models?q=board%20game%20tray",
  },
  {
    id: crypto.randomUUID(),
    name: "ווים מתחת למדף",
    cost: 6,
    description: "ווים נתפסים למדף בלי ברגים, לכוסות או אביזרי מטבח קטנים.",
    image: "assets/products/under-shelf-hooks.png",
    stlUrl: "https://www.printables.com/search/models?q=under%20shelf%20hooks",
  },
  createIdeaProduct({
    name: "מחלקי מגירות מודולריים",
    titleEn: "Modular Drawer Organizer",
    category: "ארגון וסדר לבית",
    description: "מערכת מודולרית לחלוקה פנימית של מגירות בבית, במטבח, במשרד או בשולחן עבודה.",
    useCase: "מתאים לסכו״ם, כבלים, כלי כתיבה, ברגים, כלי מטבח קטנים ואביזרים יומיומיים.",
    source: "Printables",
    url: "https://www.printables.com/model/120962-modular-drawer-organizer",
    material: "PLA",
    difficulty: "קל",
    note: "מומלץ למדוד את המגירה לפני הדפסה.",
  }),
  createIdeaProduct({
    name: "אוסף מחלקי מגירות",
    titleEn: "Drawer Dividers Collection",
    category: "ארגון וסדר לבית",
    description: "עמוד עם מגוון מחלקי מגירות להדפסה.",
    useCase: "מתאים למשתמש שרוצה לבחור פתרון לפי מידות המגירה שלו.",
    source: "Printables",
    url: "https://www.printables.com/tag/drawerdividers",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "מארגן מגירה מותאם אישית",
    titleEn: "Customisable Drawer Organizer",
    category: "ארגון וסדר לבית",
    description: "מארגן מגירות גמיש שניתן להתאים לפי גודל וצורת המגירה.",
    useCase: "מתאים למי שרוצה פתרון מדויק יותר ולא רק קופסאות מוכנות.",
    source: "Printables",
    url: "https://www.printables.com/model/181089-customisable-drawer-organizer",
    material: "PLA",
    difficulty: "בינוני",
  }),
  createIdeaProduct({
    name: "ארגונית לחלקים קטנים",
    titleEn: "Parts Organizer",
    category: "ארגון וסדר לבית",
    description: "קופסאות או תאים קטנים לאחסון ברגים, רכיבי אלקטרוניקה, מחברים וחלקים קטנים.",
    useCase: "מעולה לשולחן עבודה, תחביבים, תיקונים וציוד טכני.",
    source: "Printables",
    url: "https://www.printables.com/tag/partsorganizer",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "ארגון כלי עבודה",
    titleEn: "Tool Organization",
    category: "ארגון וסדר לבית",
    description: "מחזיקים ומתלים לכלי עבודה, ביטים, מברגים, פליירים ואביזרי עבודה.",
    useCase: "מתאים לסדנה ביתית, שולחן תיקונים, מגירות כלי עבודה או קיר כלים.",
    source: "Printables",
    url: "https://www.printables.com/tag/toolorganization",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "עציץ חתול חמוד לסוקולנט",
    titleEn: "Cute Kawaii Cat Succulent Planter",
    category: "נוי וקישוט לבית",
    description: "עציץ קטן וחמוד בצורת חתול, מתאים לסוקולנטים או קישוט מדף.",
    useCase: "מתאים לקישוט חדר, שולחן עבודה, מתנה קטנה או מוצר נוי.",
    source: "Printables",
    url: "https://www.printables.com/model/1716448-cute-kawaii-cat-succulent-planter/files",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "אוסף עציצים להדפסה",
    titleEn: "Planter Models",
    category: "נוי וקישוט לבית",
    description: "עמוד עם מגוון עציצים להדפסה תלת־ממדית.",
    useCase: "מתאים למשתמשים שמחפשים קישוטים לבית, עציצים קטנים או מתנות.",
    source: "Printables",
    url: "https://www.printables.com/tag/planter",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "אוסף עציצים ואגרטלים",
    titleEn: "Flowerpot Models",
    category: "נוי וקישוט לבית",
    description: "עמוד תגית לעציצים, flowerpots ואגרטלים דקורטיביים.",
    useCase: "מתאים לקישוט הבית, מדפים, שולחן עבודה או אדן חלון.",
    source: "Printables",
    url: "https://www.printables.com/tag/flowerpot",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "עציץ לאבובו",
    titleEn: "Labubu Planter",
    category: "נוי וקישוט לבית",
    description: "עציץ חמוד בסגנון פופולרי, מתאים לסוקולנטים או קישוט.",
    useCase: "טוב כפריט חמוד לקישוט או מתנה.",
    source: "Printables",
    url: "https://www.printables.com/model/1472968-labubu-planter",
    material: "PLA",
    difficulty: "קל",
    note: "ייתכן שיש רגישות לזכויות יוצרים/מותג. לא להציג כמתאים למכירה בלי בדיקת רישיון.",
  }),
  createIdeaProduct({
    name: "אוסף דמויות אנימה",
    titleEn: "Anime Models",
    category: "אנימה ודמויות",
    description: "עמוד תגית עם דמויות, פסלונים ואביזרים בסגנון אנימה.",
    useCase: "מתאים למשתמשים שמחפשים דמויות קטנות להדפסה אישית.",
    source: "Printables",
    url: "https://www.printables.com/tag/anime",
    material: "PLA",
    difficulty: "בינוני",
    note: "דמויות מוכרות עלולות להיות מוגנות בזכויות יוצרים. לא להציג כמתאים לשימוש מסחרי.",
  }),
  createIdeaProduct({
    name: "אוסף דמויות צ׳יבי",
    titleEn: "Chibi Models",
    category: "אנימה ודמויות",
    description: "עמוד תגית לדמויות צ׳יבי קטנות וחמודות.",
    useCase: "מתאים לקישוט, צעצועי מדף, דמויות אספנות והדפסות קטנות.",
    source: "Printables",
    url: "https://www.printables.com/tag/chibi",
    material: "PLA",
    difficulty: "בינוני",
    note: "יש לבדוק רישיון לכל מודל בנפרד.",
  }),
  createIdeaProduct({
    name: "דמות צ׳יבי אנימה",
    titleEn: "Chibi Anime Girl",
    category: "אנימה ודמויות",
    description: "דמות קטנה בסגנון אנימה/צ׳יבי להדפסה.",
    useCase: "קישוט מדף, מתנה או דמות אספנות קטנה.",
    source: "Printables",
    url: "https://www.printables.com/model/440482-chibi-anime-girl",
    material: "PLA",
    difficulty: "בינוני",
    note: "לא להניח שמותר שימוש מסחרי בלי בדיקת רישיון.",
  }),
  createIdeaProduct({
    name: "אוסף מודלים בסגנון נארוטו",
    titleEn: "Naruto Models",
    category: "אנימה ודמויות",
    description: "עמוד תגית למודלים שקשורים לנארוטו.",
    useCase: "מתאים לחיפוש דמויות, סמלים ואביזרי קוספליי קטנים להדפסה אישית.",
    source: "Printables",
    url: "https://www.printables.com/tag/naruto",
    material: "PLA",
    difficulty: "בינוני",
    note: "מותגים ודמויות מוכרות מוגנים בזכויות יוצרים. לא להציג כמתאים למכירה.",
  }),
  createIdeaProduct({
    name: "אוסף מודלים בסגנון טוטורו",
    titleEn: "Totoro Models",
    category: "אנימה ודמויות",
    description: "עמוד תגית למודלים בסגנון טוטורו.",
    useCase: "מתאים להדפסות נוי חמודות ואנימה.",
    source: "Printables",
    url: "https://www.printables.com/tag/totoro",
    material: "PLA",
    difficulty: "בינוני",
    note: "מותגים ודמויות מוכרות מוגנים בזכויות יוצרים. לא להציג כמתאים למכירה.",
  }),
  createIdeaProduct({
    name: "ווים לעגלה",
    titleEn: "Stroller Hooks",
    category: "פתרונות להורים צעירים",
    description: "עמוד תגית עם ווים ומתלים לעגלות.",
    useCase: "שימושי לתליית תיק קל או אביזרים קטנים על עגלה.",
    source: "Printables",
    url: "https://www.printables.com/tag/strollerhook",
    material: "PETG",
    difficulty: "בינוני",
    note: "לא להעמיס משקל כבד על עגלה ולא להשתמש כחלק בטיחותי.",
  }),
  createIdeaProduct({
    name: "וו אוניברסלי לעגלה",
    titleEn: "Universal Stroller Hook",
    category: "פתרונות להורים צעירים",
    description: "וו כללי לעגלה, מתאים לתליית אביזרים קלים.",
    useCase: "פתרון נוח להורים צעירים בזמן יציאה מהבית.",
    source: "Printables",
    url: "https://www.printables.com/model/455254-universal-stroller-hook/collections",
    material: "PETG",
    difficulty: "בינוני",
    note: "לבדוק התאמה לקוטר הידית ולכיוון ההדפסה.",
  }),
  createIdeaProduct({
    name: "וו שקיות לעגלת תינוק",
    titleEn: "Bag Hook for Baby Stroller",
    category: "פתרונות להורים צעירים",
    description: "וו לתליית שקיות או תיק קל על עגלה.",
    useCase: "עוזר להורים כשצריך יד נוספת לקניות קלות או תיק קטן.",
    source: "Printables",
    url: "https://www.printables.com/model/119409-bag-hook-for-baby-stroller",
    material: "PETG",
    difficulty: "בינוני",
    note: "לא להשתמש לעומסים כבדים. להציג כפתרון אביזר בלבד ולא כמוצר בטיחות.",
  }),
  createIdeaProduct({
    name: "קליפס לגגון עגלה",
    titleEn: "Stroller Hood Clip",
    category: "פתרונות להורים צעירים",
    description: "קליפס לחיבור בד קל, מגבת קלה או הצללה לגגון עגלה.",
    useCase: "שימושי כהצללה זמנית או קיבוע קל.",
    source: "Printables",
    url: "https://www.printables.com/model/502049-abc-design-stroller-hood-clip",
    material: "PETG",
    difficulty: "קל",
    note: "לא לכסות עגלה באופן שפוגע באוורור.",
  }),
  createIdeaProduct({
    name: "ארגונית לרווח בין מושב לקונסולה",
    titleEn: "Car Seat Gap Organizer",
    category: "רכב ומשרד",
    description: "ארגונית קטנה לרכב שנכנסת בין המושב לקונסולה.",
    useCase: "מתאימה לטלפון, כרטיסים, מטבעות, עט או אביזרים קטנים.",
    source: "Printables",
    url: "https://www.printables.com/model/52411-car-seat-gap-organizer/collections",
    material: "PETG",
    difficulty: "בינוני",
    note: "PETG עדיף לרכב בגלל חום. PLA עלול להתעוות בשמש.",
  }),
  createIdeaProduct({
    name: "מעצור/ארגונית לתא מטען",
    titleEn: "Car Trunk Organizer",
    category: "רכב ומשרד",
    description: "מעצור לתא המטען שמונע מחפצים לזוז בזמן נסיעה.",
    useCase: "מתאים לקניות, תיקים, ארגזים וחפצים בתא המטען.",
    source: "Printables",
    url: "https://www.printables.com/model/526739-car-trunk-organizer",
    material: "PETG",
    difficulty: "קל",
    note: "המודל דורש בדרך כלל חיבור סקוץ׳/ולקרו לתחתית.",
  }),
  createIdeaProduct({
    name: "מחזיקי ולקרו לתא מטען",
    titleEn: "Trunk Velcro Holders",
    category: "רכב ומשרד",
    description: "מחזיקים פשוטים שמתחברים לרצפת תא המטען באמצעות ולקרו.",
    useCase: "פתרון פשוט וזול לארגון תא המטען.",
    source: "Printables",
    url: "https://www.printables.com/model/598851-trunk-velcro-holders/related",
    material: "PETG",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "מחזיקי כוסות לרכב",
    titleEn: "Car Cup Holders",
    category: "רכב ומשרד",
    description: "עמוד תגית עם מחזיקי כוסות ומתאמים לרכב.",
    useCase: "מתאים למי שרוצה להוסיף או להתאים מחזיק כוסות ברכב.",
    source: "Printables",
    url: "https://www.printables.com/tag/carcupholder",
    material: "PETG",
    difficulty: "בינוני",
    note: "ברכב מומלץ PETG או חומר עמיד יותר, כי PLA עלול להתעוות בחום.",
  }),
  createIdeaProduct({
    name: "ארגונית לקונסולה ברכב",
    titleEn: "Console Organizer",
    category: "רכב ומשרד",
    description: "ארגונית לתא הקונסולה ברכב, ניתנת להתאמה לרכבים שונים.",
    useCase: "מתאימה לסידור מטבעות, מפתחות, כרטיסים, מטענים ואביזרים קטנים.",
    source: "Printables",
    url: "https://www.printables.com/model/907809-console-organizer",
    material: "PETG",
    difficulty: "בינוני",
    note: "ברכב מומלץ PETG או חומר עמיד יותר, כי PLA עלול להתעוות בחום.",
  }),
  createIdeaProduct({
    name: "אוסף אינסרטים למשחקי קופסה",
    titleEn: "Board Game Inserts Collection",
    category: "משחקים ופידג׳טים",
    description: "אוסף גדול של אינסרטים וארגוניות למשחקי קופסה.",
    useCase: "מתאים לשחקני משחקי קופסה שרוצים לקצר setup ולשמור על סדר בקופסה.",
    source: "MakerWorld",
    url: "https://makerworld.com/en/collections/1245676-board-game-inserts",
    material: "PLA",
    difficulty: "בינוני",
  }),
  createIdeaProduct({
    name: "מחזיק קלפים למשחקי קופסה",
    titleEn: "Board Game Card Holder",
    category: "משחקים ופידג׳טים",
    description: "מחזיק קלפים פשוט למשחקי קופסה, במקור עבור קלפי קטאן.",
    useCase: "עוזר לסדר קלפים על השולחן ולשמור על אזור משחק נקי.",
    source: "Printables",
    url: "https://www.printables.com/model/679611-board-game-card-holder",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "מחזיק קלפים לקטאן",
    titleEn: "Catan Card Holder",
    category: "משחקים ופידג׳טים",
    description: "מחזיק קלפים למשחק קטאן, מתאים לקלפי משאבים ופיתוח.",
    useCase: "שימושי מאוד למי שמשחק קטאן ורוצה לסדר את הקלפים.",
    source: "Printables",
    url: "https://www.printables.com/model/259724-catan-card-holder",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "אוסף מחזיקי חפיסות קלפים",
    titleEn: "Deck Holders Collection",
    category: "משחקים ופידג׳טים",
    description: "אוסף של מחזיקים פשוטים לחפיסות קלפים ומשחקי קופסה.",
    useCase: "מתאים למשחקי קלפים, משחקי קופסה וקלפי TCG.",
    source: "Printables",
    url: "https://www.printables.com/model/724930-deck-holders-collection",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "אוסף מחזיקי קלפים",
    titleEn: "Playing Card Holders",
    category: "משחקים ופידג׳טים",
    description: "עמוד תגית עם מחזיקי קלפים מסוגים שונים.",
    useCase: "מתאים למשחקי קופסה, ילדים, מבוגרים או אנשים שמתקשים להחזיק הרבה קלפים ביד.",
    source: "Printables",
    url: "https://www.printables.com/tag/playingcardholder",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "אוסף פידג׳טים",
    titleEn: "Fidget Toys",
    category: "משחקים ופידג׳טים",
    description: "עמוד קהילה/אוסף סביב פידג׳טים להדפסה.",
    useCase: "מתאים לצעצועים קטנים, משחקי ידיים, הדפסות כיפיות וניסוי במדפסת.",
    source: "Thingiverse",
    url: "https://www.thingiverse.com/groups/fidget",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "פידג׳ט ספירלה",
    titleEn: "Spiral Cone Fidget Toy",
    category: "משחקים ופידג׳טים",
    description: "פידג׳ט ספירלי קטן עם תנועה חלקה ומספקת.",
    useCase: "מתאים כהדפסה מהירה, צעצוע שולחני או בדיקת איכות הדפסה.",
    source: "Thingiverse",
    url: "https://www.thingiverse.com/thing:6613158",
    material: "PLA",
    difficulty: "קל",
  }),
  createIdeaProduct({
    name: "פידג׳ט קליקר",
    titleEn: "Fidget Clicker",
    category: "משחקים ופידג׳טים",
    description: "פידג׳ט קטן בסגנון קליקר.",
    useCase: "מתאים למשתמשים שאוהבים קליקים, צעצועי יד ושולחן עבודה.",
    source: "Thingiverse",
    url: "https://www.thingiverse.com/thing:6932353",
    material: "PLA",
    difficulty: "קל",
  }),
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

let state = loadState();
let currentUser = loadSession();
let appMode = currentUser?.role === "admin" ? "admin" : "friend";

const loginForm = document.querySelector("#login-form");
const loginUser = document.querySelector("#login-user");
const loginError = document.querySelector("#login-error");
const catalogGrid = document.querySelector("#catalog-grid");
const cardTemplate = document.querySelector("#product-card-template");
const orderDialog = document.querySelector("#order-dialog");
const orderForm = document.querySelector("#order-form");
const ordersTable = document.querySelector("#orders-table");
const debtGrid = document.querySelector("#debt-grid");
const productForm = document.querySelector("#product-form");
const productsTable = document.querySelector("#products-table");
const aiProductIdea = document.querySelector("#ai-product-idea");
const viewModeButtons = document.querySelectorAll(".view-mode-button");

populateLoginUsers();

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const user = demoUsers.find((demoUser) => demoUser.id === data.get("userId"));

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
  applyAuth();
  applyMode();
  setView(appMode === "admin" ? "orders" : "landing");
  render();
});

document.querySelector("#logout-button").addEventListener("click", () => {
  if (orderDialog.open) {
    orderDialog.close();
  }
  currentUser = null;
  appMode = "friend";
  localStorage.removeItem(SESSION_KEY);
  applyAuth();
  setView("landing");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

viewModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (currentUser?.role !== "admin") return;

    appMode = button.dataset.modeTarget;
    applyMode();
    setView(appMode === "admin" ? "orders" : "landing");
  });
});

document.querySelectorAll("[data-goto-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.gotoView));
});

document.querySelector("#reset-demo").addEventListener("click", () => {
  state = createDemoState();
  saveState();
  render();
});

document.querySelector(".close-button").addEventListener("click", () => orderDialog.close());
document.querySelector("#cancel-order").addEventListener("click", () => orderDialog.close());

document.querySelector("#ai-draft-button").addEventListener("click", () => {
  const draft = createAiProductDraft(aiProductIdea.value);
  productForm.elements["name"].value = draft.name;
  productForm.elements["cost"].value = draft.cost;
  productForm.elements["description"].value = draft.description;
  productForm.elements["image"].value = draft.image;
  productForm.elements["stlUrl"].value = draft.stlUrl;
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(productForm);
  const imageFromFile = await readImageFile(data.get("imageFile"));
  const product = {
    id: crypto.randomUUID(),
    name: data.get("name").trim(),
    cost: Number(data.get("cost")),
    description: data.get("description").trim(),
    image: imageFromFile || data.get("image").trim() || getDemoImage(state.products.length),
    stlUrl: data.get("stlUrl").trim(),
  };

  state.products.push(product);
  productForm.reset();
  saveState();
  render();
  setView("product-list");
});

orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(orderForm);
  const product = findProduct(data.get("productId"));
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

orderForm.quantity.addEventListener("input", updateOrderMinimum);

function createDemoState() {
  return {
    products: structuredClone(demoProducts),
    orders: structuredClone(demoOrders),
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : createDemoState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function populateLoginUsers() {
  demoUsers.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.name} - ${user.role === "admin" ? "מנהל" : "חבר"}`;
    loginUser.append(option);
  });
}

function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;

  try {
    const session = JSON.parse(saved);
    return demoUsers.some((user) => user.id === session.id && user.role === session.role) ? session : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
}

function applyAuth() {
  document.body.dataset.auth = currentUser ? "signed-in" : "signed-out";
  document.body.dataset.role = currentUser?.role ?? "friend";
  document.querySelector("#current-user").textContent = currentUser
    ? `${currentUser.name} - ${currentUser.role === "admin" ? "מנהל" : "חבר"}`
    : "";
}

function applyMode() {
  if (!currentUser) return;
  if (currentUser.role !== "admin") {
    appMode = "friend";
  }

  document.body.dataset.mode = appMode;
  viewModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.modeTarget === appMode);
  });

  if (appMode === "friend") {
    document.querySelector("#catalog-title").textContent = "מה אפשר להדפיס?";
    document.querySelector("#catalog-view .section-heading p").textContent =
      "בחר מוצר, כמות וסכום שנראה לך הוגן. המינימום הוא עלות ההדפסה.";
    return;
  }

  document.querySelector("#catalog-title").textContent = "קטלוג מוצרים";
  document.querySelector("#catalog-view .section-heading p").textContent =
    "בחר מוצר, כמות וסכום לתשלום. המינימום הוא עלות ההדפסה.";
}

function setView(viewName) {
  if (!currentUser) return;
  const friendViews = ["landing", "catalog"];
  const nextView =
    appMode === "friend"
      ? friendViews.includes(viewName) ? viewName : "landing"
      : friendViews.includes(viewName) ? "orders" : viewName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === nextView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextView}-view`);
  });
}

function render() {
  if (!currentUser) return;
  renderCatalog();
  renderOrders();
  renderDebts();
  renderProducts();
  renderSummary();
}

function renderCatalog() {
  catalogGrid.replaceChildren();

  state.products.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".product-image").style.backgroundImage = `url("${product.image || getDemoImage(0)}")`;
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent = product.description;
    card.querySelector(".cost").textContent = `עלות ייצור : ${formatCurrency(product.cost)}`;
    renderStlLink(card, product);
    card.querySelector("button").addEventListener("click", () => openOrderDialog(product.id));
    catalogGrid.append(card);
  });
}

function renderOrders() {
  ordersTable.replaceChildren();
  document.querySelector("#orders-empty").classList.toggle("is-visible", state.orders.length === 0);

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
  debtGrid.replaceChildren();
  const debts = state.orders.reduce((totals, order) => {
    if (!order.paid) {
      totals[order.friendName] = (totals[order.friendName] ?? 0) + order.price;
    }
    return totals;
  }, {});

  const entries = Object.entries(debts).sort((a, b) => b[1] - a[1]);
  document.querySelector("#debts-empty").classList.toggle("is-visible", entries.length === 0);

  entries.forEach(([friendName, total]) => {
    const card = document.createElement("article");
    card.className = "debt-card";
    card.innerHTML = `<strong>${escapeHtml(friendName)}</strong><span>${formatCurrency(total)}</span>`;
    debtGrid.append(card);
  });
}

function renderProducts() {
  productsTable.replaceChildren();
  document.querySelector("#products-empty").classList.toggle("is-visible", state.products.length === 0);

  state.products.forEach((product) => {
    const row = document.createElement("tr");
    row.className = "product-edit-row";

    const imageCell = document.createElement("td");
    const preview = document.createElement("div");
    preview.className = "product-thumb";
    preview.style.backgroundImage = `url("${product.image || getDemoImage(0)}")`;
    imageCell.append(preview);

    const nameCell = document.createElement("td");
    nameCell.append(createEditableInput(product, "name", "text"));

    const orderedCell = document.createElement("td");
    orderedCell.className = "ordered-count";
    orderedCell.textContent = getProductOrderedQuantity(product.id);

    const costCell = document.createElement("td");
    costCell.append(createEditableInput(product, "cost", "number"));

    const descriptionCell = document.createElement("td");
    const descriptionInput = document.createElement("textarea");
    descriptionInput.value = product.description;
    descriptionInput.rows = 3;
    descriptionInput.addEventListener("change", () => updateProduct(product.id, { description: descriptionInput.value.trim() }));
    descriptionCell.append(descriptionInput);

    const imageUrlCell = document.createElement("td");
    imageUrlCell.append(createEditableInput(product, "image", "text"));

    const imageFileCell = document.createElement("td");
    const imageFileInput = document.createElement("input");
    imageFileInput.type = "file";
    imageFileInput.accept = "image/*";
    imageFileInput.addEventListener("change", async () => {
      const image = await readImageFile(imageFileInput.files[0]);
      if (image) updateProduct(product.id, { image });
    });
    imageFileCell.append(imageFileInput);

    const stlCell = document.createElement("td");
    stlCell.append(createEditableInput(product, "stlUrl", "url"));

    const actionsCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-button";
    deleteButton.type = "button";
    deleteButton.textContent = "מחיקה";
    deleteButton.addEventListener("click", () => deleteProduct(product.id));
    actionsCell.append(deleteButton);

    row.append(imageCell, nameCell, orderedCell, costCell, descriptionCell, imageUrlCell, imageFileCell, stlCell, actionsCell);
    productsTable.append(row);
  });
}

function renderSummary() {
  const openOrders = state.orders.filter((order) => !order.paid).length;
  const totalDebt = state.orders.reduce((sum, order) => sum + (order.paid ? 0 : order.price), 0);
  document.querySelector("#summary-orders").textContent = openOrders;
  document.querySelector("#summary-debt").textContent = formatCurrency(totalDebt);
}

function openOrderDialog(productId) {
  const product = findProduct(productId);
  orderForm.reset();
  orderForm.productId.value = product.id;
  orderForm.friendName.value = appMode === "friend" ? currentUser.name : "";
  orderForm.friendName.readOnly = appMode === "friend";
  orderForm.quantity.value = 1;
  orderForm.price.value = product.cost;
  orderForm.price.min = product.cost;
  document.querySelector("#order-product-name").textContent = product.name;
  document.querySelector("#order-product-description").textContent = product.description;
  updateOrderMinimum();
  orderDialog.showModal();
}

function updateOrderMinimum() {
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

function createIdeaProduct({ name, titleEn, category, description, useCase, source, url, material, difficulty, note = "" }) {
  const summary = `${titleEn} - ${cleanSentencePart(description)} ${cleanSentencePart(useCase)}.`;
  const printDetails = `מקור: ${source}; חומר מומלץ: ${material}; רמת קושי: ${difficulty}.`;
  const licenseWarning = "יש לבדוק רישיון וזכויות יוצרים לפני שימוש מסחרי.";
  const descriptionParts = [summary, printDetails, ensureSentence(note || licenseWarning)];

  return {
    id: crypto.randomUUID(),
    name,
    cost: 1,
    description: descriptionParts.join(" "),
    image: sourceImageByUrl[url] ?? ideaCategoryImages[category] ?? "assets/products/cable-clips.png",
    stlUrl: url,
  };
}

function cleanSentencePart(value) {
  return value.trim().replace(/[.!?]+\s+/gu, ", ").replace(/[.!?]+$/u, "");
}

function ensureSentence(value) {
  return `${cleanSentencePart(value)}.`;
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
    input.min = 1;
    input.step = 1;
  }

  input.addEventListener("change", () => {
    const value = field === "cost" ? Number(input.value) : input.value.trim();
    updateProduct(product.id, { [field]: value });
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

function deleteProduct(productId) {
  if (!window.confirm("למחוק את המוצר מהקטלוג?")) return;

  state.products = state.products.filter((product) => product.id !== productId);
  saveState();
  render();
}

function readImageFile(file) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => resolve(""));
    reader.readAsDataURL(file);
  });
}

function getDemoImage(index) {
  const images = demoProducts.map((product) => product.image);
  return images[index % images.length];
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
    description: trimmedIdea
      ? `מוצר פרקטי בהדפסת PLA עבור ${trimmedIdea}. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`
      : `מוצר קטן ושימושי לבית, מתאים לסידור יומיומי. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`,
    image: getDemoImage(state.products.length),
    stlUrl: "",
  };
}

function estimatePlaCost(weightGrams) {
  return Math.ceil((weightGrams / 1000) * PLA_COST_PER_KG);
}

function getOrderFriendName(data) {
  return appMode === "friend" ? currentUser.name : data.get("friendName").trim();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

applyAuth();
applyMode();
setView(appMode === "admin" ? "orders" : "landing");
render();
