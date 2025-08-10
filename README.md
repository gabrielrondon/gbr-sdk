
# gbr-csv

Um SDK de alta performance em WebAssembly para processar arquivos CSV. Ele lê um CSV, valida se não existem campos vazios em cada linha e gera um hash SHA-256 para cada linha válida.

**Processamento 100% on-premise** - Seus dados nunca saem do seu servidor!

## Instalação

Instale o pacote usando npm:

```bash
npm install gbr-csv
```

## Como Usar

O pacote expõe uma única função `processCsv` que recebe o caminho para o arquivo CSV e retorna uma Promise.

```javascript
const { processCsv } = require('gbr-csv');
const path = require('path');

const filePath = path.join(__dirname, 'seu_arquivo.csv');

// Versão assíncrona (recomendada)
processCsv(filePath)
  .then(result => {
    console.log('Linhas Processadas:');
    console.log(result.processed_rows);

    console.log('\nErros de Validação:');
    console.log(result.errors);
  })
  .catch(error => {
    console.error('Ocorreu um erro:', error);
  });

// Versão síncrona também disponível
const { processCsvSync } = require('gbr-csv');
const result = processCsvSync(filePath);
```

## Funcionalidades

- 🚀 **Alta Performance**: Processamento em WebAssembly (Rust compilado)
- 🔒 **100% On-Premise**: Seus dados nunca saem do seu servidor
- ✅ **Validação Automática**: Detecta e reporta campos vazios
- 🔐 **Hash SHA-256**: Geração de hash único para cada linha válida
- 📊 **Relatório Detalhado**: Linhas processadas com sucesso e erros separados
- 💾 **Zero Dependências Externas**: Apenas Node.js necessário

## Retorno da Função

```javascript
{
  processed_rows: [
    {
      line: 2,                    // Número da linha no CSV
      data: { col1: "val1", ... }, // Dados parseados
      hash: "sha256..."           // Hash SHA-256 da linha
    }
  ],
  errors: [
    {
      line: 4,                    // Linha com erro
      error: "Mensagem do erro",  // Descrição do problema
      raw_data: "dados originais" // Dados brutos da linha
    }
  ]
}
```

## Outras Linguagens

Atualmente suportamos **Node.js/JavaScript**. 

Interessado em usar com outras linguagens? Estamos expandindo conforme demanda:

- 🐍 **Python** - Em desenvolvimento
- ☕ **Java/JVM** - Planejado
- 🔷 **.NET/C#** - Planejado  
- 🦀 **Rust nativo** - Planejado
- 🌐 **Browser/Web** - Planejado

**Precisa de suporte para sua linguagem?** Entre em contato: grondon@gmail.com

## Requisitos

- Node.js 14.0 ou superior
- npm ou yarn
- **NÃO** precisa instalar Rust, WebAssembly ou qualquer compilador!

## Scripts

- `npm run build`: Compila o módulo WebAssembly (apenas para desenvolvimento)
- `npm test`: Executa testes e linter

## Licença

ISC
