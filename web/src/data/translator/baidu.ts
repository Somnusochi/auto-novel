import { KyInstance } from 'ky/distribution/types/ky';

import {
  Glossary,
  Translator,
  createLengthSegmenterWrapper,
  createNonAiGlossaryWrapper,
  emptyLineFilterWrapper,
} from './base';

export class BaiduTranslator implements Translator {
  private api: KyInstance;
  private log: (message: string) => void;
  private glossaryWarpper: ReturnType<typeof createNonAiGlossaryWrapper>;
  private segmentWarpper: ReturnType<typeof createLengthSegmenterWrapper>;

  constructor(
    api: KyInstance,
    log: (message: string) => void,
    glossary: Glossary
  ) {
    this.api = api.create({
      prefixUrl: 'https://fanyi.baidu.com',
      credentials: 'include',
    });
    this.log = log;
    this.glossaryWarpper = createNonAiGlossaryWrapper(glossary);
    this.segmentWarpper = createLengthSegmenterWrapper(2000);
  }

  translate = async (input: string[]) => {
    if (input.length === 0) return [];
    return emptyLineFilterWrapper(input, (input) =>
      this.glossaryWarpper(input, (input) =>
        this.segmentWarpper(input, (seg, _segInfo) =>
          this.translateSegment(seg)
        )
      )
    );
  };

  private token = '';
  private gtk = '';

  async init() {
    await this.loadMainPage();
    await this.loadMainPage();
    if (this.token === '') throw Error('无法获取token');
    if (this.gtk === '') throw Error('无法获取gtk');
    return this;
  }

  private async loadMainPage() {
    const html = await this.api.get('').text();

    const match = (pattern: RegExp) => {
      const res = html.match(pattern);
      if (res) return res[1];
      else return null;
    };

    this.token = match(/token: '(.*?)',/) ?? '';
    this.gtk =
      match(/window\.gtk = "(.*?)";/) ?? // Desktop
      match(/gtk: '(.*?)'/) ?? // Mobile
      '';
  }

  async translateSegment(input: string[]): Promise<string[]> {
    // 开头的空格似乎会导致998错误
    const newInput = input.slice();
    newInput[0] = newInput[0].trimStart();
    const query = newInput.join('\n');

    const json: any = await this.api
      .post('v2transapi', {
        body: new URLSearchParams({
          from: 'jp',
          to: 'zh',
          query,
          simple_means_flag: '3',
          sign: sign(query, this.gtk),
          token: this.token,
          domain: 'common',
        }),
      })
      .json();

    if ('error' in json) {
      throw Error(`百度翻译错误：${json.error}: ${json.msg}`);
    } else if ('errno' in json) {
      if (json.errno == 1000) {
        throw Error(
          `百度翻译错误：${json.errno}: ${json.errmsg}，可能是因为输入为空`
        );
      } else {
        throw Error(`百度翻译错误：${json.errno}: ${json.errmsg}`);
      }
    } else {
      return json.trans_result.data.map((item: any) => item.dst);
    }
  }
}

function a(r: any, o: any) {
  for (var t = 0; t < o.length - 2; t += 3) {
    var a = o.charAt(t + 2);
    (a = a >= 'a' ? a.charCodeAt(0) - 87 : Number(a)),
      (a = '+' === o.charAt(t + 1) ? r >>> a : r << a),
      (r = '+' === o.charAt(t) ? (r + a) & 4294967295 : r ^ a);
  }
  return r;
}

const sign = function (r: string, gtk: string) {
  if (r.length > 30) {
    const first10Chars = r.substr(0, 10);
    const middle10Chars = r.substr(Math.floor(r.length / 2) - 5, 10);
    const last10Chars = r.substring(r.length - 10, r.length);
    r = first10Chars + middle10Chars + last10Chars;
  }

  const encodedCodes = [];
  for (let i = 0; i < r.length; i++) {
    let char = r.charCodeAt(i);
    if (char < 0x80) {
      encodedCodes.push(char);
    } else {
      if (char < 0x800) {
        encodedCodes.push((char >> 6) | 0xC0);
      } else if (
        0xD800 === (0xFC00 & char) &&
        i + 1 < r.length &&
        0xDC00 === (0xFC00 & r.charCodeAt(i + 1))
      ) {
        char = 0x10000 + ((1023 & 0x3FF) << 10) + (0x3FF & r.charCodeAt(++i));
        encodedCodes.push((char >> 18) | 0xF0);
        encodedCodes.push(((char >> 12) & 0x3F) | 0x80);
      } else {
        encodedCodes.push((char >> 12) | 0xE0);
        encodedCodes.push(((char >> 6) & 0x3F) | 0x80);
      }
      encodedCodes.push((63 & char) | 0x80);
    }
  }

  const gtkArray = gtk.split('.');
  const gtk1 = Number(gtkArray[0]) || 0;
  const gtk2 = Number(gtkArray[1]) || 0;

  let S = gtk1;
  const key1 = '+-a^+6';
  const key2 = '+-3^+b+-f';

  for (let s = 0; s < encodedCodes.length; s++) {
    S += encodedCodes[s];
    S = a(S, key1);
  }

  S = a(S, key2);

  S ^= gtk2;

  if (S < 0) {
    S = (2147483647 & S) + 2147483648;
  }

  S %= 1e6;

  return S.toString() + '.' + (S ^ gtk1);
};