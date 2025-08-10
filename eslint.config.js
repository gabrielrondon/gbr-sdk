
module.exports = [
  {
    'files': ['**/*.js'],
    'languageOptions': {
      'ecmaVersion': 'latest',
      'sourceType': 'commonjs',
      'globals': {
        'node': true
      }
    },
    'rules': {
      'indent': ['error', 2],
      'linebreak-style': ['error', 'unix'],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always']
    }
  }
];
