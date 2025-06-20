process.env['NODE_DEV'] = 'TEST';
const { format_date } = require('./index.js');
const { build_adobe_payload } = require('./index.js');
const {recursive_remove_nulls} = require('./index.js');
const {format_bool} = require('./index.js');

jest.spyOn(global.console, 'log').mockImplementation();
jest.spyOn(global.console, 'error').mockImplementation();

describe('format_bool', () => {
  it('should return true for true', () => {
    expect(format_bool(true)).toBe(true);
  })
  it('should return true for "true"', () => {
    expect(format_bool('true')).toBe(true);
  })
  it('should return false for false', () => {
    expect(format_bool(false)).toBe(false);
  })
  it('should return false for "false"', () => {
    expect(format_bool('false')).toBe(false);
  })
  it('should return null for null', () => {
    expect(format_bool(null)).toBe(null);
  })
})

describe('format_date', () => {
  it('return true', async () => {
    expect.assertions(1);
    expect(true).toBe(true);
  });
});


describe('recursive_remove_nulls', () => {
  it('should remove null values from object', () => {
    const payload = {
      a: 1,
      b: null,
      c: {
        d: null,
        e: 2,
        f: {
          g: null,
          h: 3
        }
      }
    }
    const res = {
      a: 1,
      c: {
        e: 2,
        f: {
          h: 3
        }
      }
    }

    expect(recursive_remove_nulls(payload)).toEqual(res);
  })
}) 



