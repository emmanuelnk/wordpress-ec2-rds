/**
 * Replaces all given substring in a text with new substring e.g.
 *
 * @example
 *  const text = 'The woman and man and woman and man'
 *  const wordsArray = [{ man: 'boy' }, { woman: 'girl' }]
 *
 *  console.log(replaceAllSubstrings(wordsArray, text))
 *  // The girl and boy and girl and boy
 *
 * @param  {Array<Record<string, string>>} wordsArray the words to be substituted and the words to substitute them with
 * @param  {string} text the text from which to substitute the given sub strings
 * @returns the altered text
 */
export const replaceAllSubstrings = (
  wordsArray: Array<Record<string, string>>,
  text: string
) =>
  wordsArray.reduce(
    (f, s) =>
      `${f}`.replace(new RegExp(Object.keys(s)[0], 'g'), s[Object.keys(s)[0]]),
    text
  )


