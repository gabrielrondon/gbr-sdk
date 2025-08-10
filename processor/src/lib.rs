use wasm_bindgen::prelude::*;
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};

// Estrutura para uma linha que foi processada com sucesso
#[derive(Serialize, Deserialize)]
pub struct ProcessedRow {
    line: u64,
    data: serde_json::Value,
    hash: String,
}

// Estrutura para um erro de validação
#[derive(Serialize, Deserialize)]
pub struct ValidationError {
    line: u64,
    error: String,
    data: serde_json::Value,
}

// Estrutura para o resultado final que será retornado como JSON
#[derive(Serialize, Deserialize)]
pub struct ProcessingResult {
    processed_rows: Vec<ProcessedRow>,
    errors: Vec<ValidationError>,
}

// A função principal que será exposta ao JavaScript
#[wasm_bindgen]
pub fn process_csv_data(csv_content: &str) -> String {
    let mut rdr = csv::Reader::from_reader(csv_content.as_bytes());
    let mut processed_rows = Vec::new();
    let mut errors = Vec::new();
    let headers = rdr.headers().cloned().unwrap_or_default();

    for (i, result) in rdr.records().enumerate() {
        let line_num = (i + 2) as u64; // +1 for zero-index, +1 for header

        match result {
            Ok(record) => {
                let mut is_valid = true;
                let mut row_string = String::new();
                
                // Converte o registro para um JSON e valida campos vazios
                let json_map: serde_json::Map<String, serde_json::Value> = headers.iter()
                    .zip(record.iter())
                    .map(|(h, v)| {
                        if v.trim().is_empty() {
                            is_valid = false;
                        }
                        row_string.push_str(v);
                        row_string.push(',');
                        (h.to_string(), serde_json::Value::String(v.to_string()))
                    })
                    .collect();
                
                let json_data = serde_json::Value::Object(json_map);

                if is_valid {
                    // Remove a última vírgula
                    row_string.pop();
                    
                    // Gera o hash
                    let mut hasher = Sha256::new();
                    hasher.update(row_string.as_bytes());
                    let hash_result = hasher.finalize();
                    let hash_hex = format!("{:x}", hash_result);

                    processed_rows.push(ProcessedRow {
                        line: line_num,
                        data: json_data,
                        hash: hash_hex,
                    });
                } else {
                    errors.push(ValidationError {
                        line: line_num,
                        error: "Row contains empty fields.".to_string(),
                        data: json_data,
                    });
                }
            },
            Err(e) => {
                errors.push(ValidationError {
                    line: line_num,
                    error: format!("Failed to parse row: {}", e),
                    data: serde_json::Value::Null,
                });
            }
        }
    }

    let final_result = ProcessingResult {
        processed_rows,
        errors,
    };

    // Serializa o resultado final para uma string JSON
    serde_json::to_string(&final_result).unwrap_or_else(|_| "{\"errors\":[\"Failed to serialize result\"]}".to_string())
}