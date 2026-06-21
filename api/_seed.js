// Converts a Thingiverse resize URL → images.weserv.nl proxy URL
function makeProxyImage(thingiverseResizeUrl) {
  if (!thingiverseResizeUrl) return '';
  try {
    const resizeParsed = new URL(thingiverseResizeUrl);
    const cdnUrl = resizeParsed.searchParams.get('url') || thingiverseResizeUrl;
    const cdnParsed = new URL(cdnUrl);
    const path = `${cdnParsed.hostname}${cdnParsed.pathname}`;
    return `https://images.weserv.nl/?url=${encodeURIComponent(path)}&w=628&h=472&fit=contain&output=webp`;
  } catch {
    return '';
  }
}

// Stable product ID derived from Thingiverse thing number
function thingId(stlUrl) {
  const m = stlUrl.match(/thing:(\d+)/);
  return m ? `prod-${m[1]}` : stlUrl;
}

const RAW_PRODUCTS = [
  { stlUrl: 'https://www.thingiverse.com/thing:3598949', name: 'מחזיק מפתחות לקיר', cost: 3.3, grams: 55, description: 'מתלה קיר עם ווים ומדף קטן למפתחות/פריטים קטנים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f1/dd/82/9f/97/Key_Tray_2019-Apr-30_08-46-29PM-000_CustomizedView18435398591.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6309491', name: 'קופסת כניסה לבית', cost: 9.6, grams: 160, description: 'מגש catch-all לארנק, מפתחות, שעון ומטבעות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/98/76/ba/5b/ad/a0d89ce3-2a7a-4ce6-bf0d-48ddec0eed44.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3347414', name: 'מעמד לטלפון', cost: 2.7, grams: 45, description: 'סטנד שולחני פשוט לטלפון בזווית צפייה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f6/42/99/2e/10/02.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:644491', name: 'מחזיק משקפיים', cost: 2.4, grams: 40, description: 'מעמד קטן למשקפיים לשידה/שולחן.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/93/f5/9a/e3/6d/P1060532.JPG&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5898290', name: 'מחזיק שלט מזגן', cost: 2.7, grams: 45, description: 'תושבת קיר לשלט מזגן/טלוויזיה יחיד.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/7a/0e/8f/57/44/109d18de-2416-4626-9d80-ec888068dd4c.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6935945', name: 'ארגונית שלטים', cost: 8.1, grams: 135, description: 'מעמד קיר לשני שלטים או יותר.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/71/8e/aa/df/97/remotes_mount.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:37960', name: 'קליפס כבלים לשולחן', cost: 0.48, grams: 8, description: 'תופסן קטן שמונע מכבלי טעינה ליפול מהשולחן.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/e6/e3/bd/2a/75/cable_clips_x_3.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6155858', name: 'ארגונית כבלים', cost: 4.2, grams: 70, description: 'פתרון לניהול כבלים מתחת לשולחן/עמדת עבודה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/d9/81/17/c9/b8/d204dc84-a7fa-4399-a719-5a3a613bc48d.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2050885', name: 'מעמד לאוזניות', cost: 6.3, grams: 105, description: 'סטנד שולחני לאוזניות, מתאים לעמדת מחשב.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/fd/20/9e/68/4f/MakerBot_headphone_Stand_Render.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3827538', name: 'מפרידי מגירה מודולריים', cost: 7.2, grams: 120, description: 'מערכת מחיצות מודולרית לסידור מגירות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/3c/50/85/f7/70/IMG_9756.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:1187364', name: 'מחזיק ספוג לכיור', cost: 2.28, grams: 38, description: 'מעמד קטן לספוג/סקוץ׳ עם ניקוז.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/de/72/96/07/c2/SpongeHolder4.JPG&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6763116', name: 'מעמד לסבון כלים וסקוץ׳', cost: 6.9, grams: 115, description: 'ארגונית לכיור עבור סבון, ספוג ומברשת.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/e5/5f/1a/05/37/9bac5fc7-12c1-4f8d-9795-b7cf26645c36.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:330151', name: 'קליפסים לשקיות אוכל', cost: 0.72, grams: 12, description: 'קליפסים לסגירת שקיות מזון; הדפסה קטנה ומהירה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/2b/a9/56/2d/4e/bagClip_2.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3058310', name: 'ארגונית תבלינים', cost: 12.6, grams: 210, description: 'מדף/ארגונית לתבלינים במטבח.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f1/62/7b/d9/21/MVIMG_20180820_125633.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:80106', name: 'מחזיק קפסולות קפה', cost: 10.2, grams: 170, description: 'מסילה/מעמד לקפסולות נספרסו.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/01/5e/7a/e7/66/IMG_1969.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:1891584', name: 'מעמד לכף בישול', cost: 2.7, grams: 45, description: 'מגש לשמירה על משטח נקי בזמן בישול.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/8c/50/8c/51/95/low_poly_spoon_rest_3dprintny.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2850883', name: 'מחזיק מכסה סיר', cost: 4.5, grams: 75, description: 'תושבת/מתלה למכסה סיר במטבח.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/68/76/98/98/de/IMG_20180405_111259.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:1596322', name: 'משפך קטן', cost: 1.44, grams: 24, description: 'משפך מטבח בסיסי להעברת נוזלים/תבלינים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a2/d0/89/f6/e6/IMG_7235.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:725952', name: 'מחזיק שקיות ניילון', cost: 10.8, grams: 180, description: 'דיספנסר לאחסון ושליפה של שקיות ניילון.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/08/1c/af/1c/46/BAG_DISPENCER-1.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:7190665', name: 'מתלה מגבת מטבח', cost: 2.1, grams: 35, description: 'וו לדלת ארון/מגירה עבור מגבת מטבח.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a5/0a/c4/a7/70/Universal_towel_hook.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5151237', name: 'מחזיק מברשות שיניים', cost: 4.2, grams: 70, description: 'מעמד למברשות שיניים ומשחת שיניים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/be/19/9a/d5/e0/3.JPG&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:867811', name: 'סוחט משחת שיניים', cost: 0.96, grams: 16, description: 'כלי קטן לגלגול/סחיטת שפופרת משחת שיניים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/05/99/2c/c4/62/Toothpaste_Squeezer.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6516633', name: 'מחזיק סבון עם ניקוז', cost: 3, grams: 50, description: 'מגש סבון עם ניקוז למניעת הצטברות מים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/80/5e/84/a6/7c/30a907e5-af74-4942-b55c-5c07928d5a07.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:662714', name: 'מתלה לסכין גילוח', cost: 1.08, grams: 18, description: 'מחזיק קטן לסכין גילוח במקלחת/אמבטיה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4f/d1/65/af/f0/shaver_holder00.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6875435', name: 'ארגונית איפור / קרמים', cost: 12.6, grams: 210, description: 'ארגונית מחולקת לאיפור, קרמים ומברשות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/d7/2a/86/6d/e8/IMG_4418.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5740323', name: 'סטנד ללפטופ', cost: 18, grams: 300, description: 'סטנד נייד/מתקפל ללפטופ לשיפור זווית עבודה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/8b/96/19/a3/c7/90e888c5-dfd7-43af-ba03-32e71dcb19b9.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:37283', name: 'מעמד לטאבלט', cost: 7.5, grams: 125, description: 'מעמד מתכוונן לטאבלט או טלפון גדול.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/b3/6b/59/ca/75/DSC_0077.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2637487', name: 'מחזיק USB / כרטיסי זיכרון', cost: 3.3, grams: 55, description: 'ארגונית ל-USB, SD ו-MicroSD.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c6/7f/b5/e1/aa/USB_01.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:73489', name: 'מעמד עטים', cost: 6.6, grams: 110, description: 'כוס/מעמד לעטים, עפרונות וכלי כתיבה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/bc/e4/fd/b4/36/IMG_5710.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6426072', name: 'מעמד לספר לימוד', cost: 11.4, grams: 190, description: 'סטנד מתקפל/יציב לספר לימוד או ספר מתכונים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c8/2b/80/f0/19/779e4488-8d1f-4306-bced-6d926e2049d5.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:923111', name: 'מחזיק חגורות', cost: 5.7, grams: 95, description: 'מתלה לחגורות בארון.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/0f/9d/96/fb/58/IMG_3210.JPG&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3898441', name: 'מחזיק תכשיטים', cost: 6.9, grams: 115, description: 'סטנד/ארגונית לתכשיטים, טבעות ושרשראות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/de/f5/05/1a/0a/jewelryHolderV2.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5902365', name: 'קליפסים לגרביים בכביסה', cost: 0.84, grams: 14, description: 'קליפסים לשמירת זוגות גרביים בזמן כביסה/ייבוש.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/a3/71/65/f1/af/ebb451f9-bd4b-4d1c-884a-f3f316946627.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6791127', name: 'מחזיק נעליים בזווית', cost: 10.8, grams: 180, description: 'מודול לאחסון נעליים/הגדלת מקום במדף.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/43/bb/d5/1c/36/IMG_2380.JPG_compressed.JPEG&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6813328', name: 'תוויות למדפים בארון', cost: 0.48, grams: 8, description: 'מחזיק תגית/תווית למדף, קופסה או מגירה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/cd/d5/82/20/1a/Label_12.5_50_30.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5371231', name: 'מחזיק טלפון לרכב', cost: 5.1, grams: 85, description: 'מחזיק טלפון אוניברסלי לרכב.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/38/41/18/18/f7/1651154882116111.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2545456', name: 'מחזיק משקפי שמש לרכב', cost: 1.44, grams: 24, description: 'קליפס למגן שמש עבור משקפי שמש.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/68/06/b3/62/6c/20170920_171340.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3719476', name: 'וו לשקיות בגב מושב', cost: 2.1, grams: 35, description: 'וו לתליית שקיות קניות/תיק על משענת ראש ברכב.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/e6/81/4a/e9/b7/hrbh.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:1775488', name: 'מתקן שקית אשפה לרכב', cost: 6.3, grams: 105, description: 'מחזיק/מסגרת לשקית אשפה קטנה ברכב.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/3e/ec/a8/e6/fb/20161119_135005.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:98825', name: 'קופסה למטבעות ברכב', cost: 3.3, grams: 55, description: 'ארגונית מטבעות לכוס/קונסולה ברכב.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/renders/69/6f/77/d2/bb/photo_3.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:4740308', name: 'תוויות לעציצים', cost: 0.48, grams: 8, description: 'תגיות/שלטים לצמחים ולערוגות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/be/9f/f1/41/d6/030d2078-2540-47a5-a9ae-4938c521c7c5.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:3675279', name: 'תופסן לצמחים מטפסים', cost: 0.3, grams: 5, description: 'קליפס תמיכה לצמח וגבעול/מקל במבוק.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/45/ae/03/5c/ac/20190606_181915.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2805978', name: 'מתאם טפטוף לבקבוק', cost: 1.5, grams: 25, description: 'מתאם השקיה איטית לבקבוק PET/סודה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/19/ce/fd/5a/62/thingverse.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:5958301', name: 'תחתית לעציץ', cost: 7.2, grams: 120, description: 'צלחת ניקוז לעציץ במספר גדלים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/5d/d8/34/01/f3/0816ca48-5e8d-4477-8d78-2592f2617f92.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:2858696', name: 'קופסה לזרעים', cost: 8.1, grams: 135, description: 'קופסת אחסון לזרעים עם מכסה/אוורור.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/28/53/42/18/a1/Seed_Storage_Box_01.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:7145404', name: 'מחזיק מוצץ', cost: 2.1, grams: 35, description: 'ארגונית/מעמד למוצצים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/4d/b0/57/e2/23/5.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:4782296', name: 'וו לעגלה', cost: 3.3, grams: 55, description: 'וו לתליית תיק/שקית על עגלת תינוק.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/08/d0/1c/43/ba/Stroller_Hook.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:4910958', name: 'מחזיק בקבוק לעגלה', cost: 7.8, grams: 130, description: 'מחזיק כוס/בקבוק לעגלה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/af/81/52/90/94/Cupholder_-_Right.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6420289', name: 'ארגונית לשידת החתלה', cost: 18, grams: 300, description: 'מחזיק חיתולים וציוד בסיסי לשידת החתלה.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/f5/bc/de/e8/f3/3a20cafd-13aa-4b34-a60c-35a908a887fa.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:7047129', name: 'מגן פינות לשולחן', cost: 1.08, grams: 18, description: 'מגיני פינות לתינוקות/רהיטים, עדיף TPU.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/1d/84/b4/c6/a8/20250525_152314.jpg&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6628547', name: 'תוויות בגדי תינוק לפי מידה', cost: 0.48, grams: 8, description: 'מחיצות לארון בגדי תינוק לפי חודשים/מידות.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c4/4c/27/f1/49/9048d767-a7c3-4588-94a6-52f8682bcdd5.png&w=628&h=472&fit=contain&cbg=white&n=-1' },
  { stlUrl: 'https://www.thingiverse.com/thing:6998597', name: 'מעמד ייבוש בקבוקים', cost: 14.4, grams: 240, description: 'מתקן לייבוש בקבוקי תינוק וחלקים קטנים.', img: 'https://resize.thingiverse.com/?url=https://cdn.thingiverse.com/assets/c4/d6/81/2f/0e/mam.jpeg&w=628&h=472&fit=contain&cbg=white&n=-1' },
];

const SEED_PRODUCTS = RAW_PRODUCTS.map((p) => ({
  id: thingId(p.stlUrl),
  name: p.name,
  cost: p.cost,
  grams: p.grams,
  description: p.description,
  image: makeProxyImage(p.img),
  stlUrl: p.stlUrl,
}));

const SEED_USERS = [
  { id: 'admin',         name: 'amir',    fullName: 'אמיר הרטמן',   email: 'admin@justifymyprinter.com', role: 'admin',  password: '1236', status: 'approved' },
  { id: 'friend-lior',   name: 'lior',    fullName: 'ליאור',         email: 'lior@example.com',           role: 'friend', password: '1234', status: 'approved' },
  { id: 'friend-daniel', name: 'דניאל',   fullName: 'דניאל כהן',    email: 'daniel@example.com',         role: 'friend', password: '1234', status: 'approved' },
  { id: 'friend-noa',    name: 'נועה',    fullName: 'נועה לוי',     email: 'noa@example.com',            role: 'friend', password: '1234', status: 'approved' },
  { id: 'friend-neomi',  name: 'נעמיקי',  fullName: 'נעמי גולדברג', email: 'neomi@example.com',          role: 'friend', password: '1234', status: 'approved' },
];

const SEED_ORDERS = [
  {
    id: 'order-demo-1',
    productId: SEED_PRODUCTS[0].id,
    friendName: 'דניאל',
    quantity: 1,
    price: 25,
    status: 'ready',
    paid: false,
  },
  {
    id: 'order-demo-2',
    productId: SEED_PRODUCTS[2].id,
    friendName: 'נועה',
    quantity: 2,
    price: 60,
    status: 'printing',
    paid: false,
  },
];

module.exports = { SEED_PRODUCTS, SEED_USERS, SEED_ORDERS };
