import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../assets/i18n.js',import.meta.url),'utf8');

function localeKeys(locale){
  const marker=`${locale}: {`;
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,`missing locale ${locale}`);
  const nextLocale=source.slice(start+marker.length).match(/\n\s{4}(?:ru|sk|uk|en): \{/);
  const end=nextLocale
    ? start+marker.length+nextLocale.index
    : source.indexOf('\n  });',start);
  assert.notEqual(end,-1,`unterminated locale ${locale}`);
  return [...source.slice(start,end).matchAll(/'((?:[^'\\]|\\.)+)'\s*:/g)].map(m=>m[1]);
}

test('all non-English locales contain the core navigation and auth vocabulary',()=>{
  const required=['Live Operations','Map','Tomorrow','Jobs','Objects','Cleaners','Issues','Analytics','Settings','Finance','Clients','Home','My Day','Earnings','Profile','Book Cleaning','Bookings','Sign in','Sign out','Email','Password','Notifications','Close','Refresh','Language'];
  for(const locale of ['ru','sk','uk']){
    const keys=new Set(localeKeys(locale));
    for(const key of required)assert.ok(keys.has(key),`${locale} is missing translation key: ${key}`);
  }
});

test('translation source declares exactly the four supported locales and english uses fallback mode',()=>{
  assert.match(source,/const LANGS = \['ru','sk','uk','en'\]/);
  assert.match(source,/if \(locale === 'en'\) return fallback \?\? key/);
});
