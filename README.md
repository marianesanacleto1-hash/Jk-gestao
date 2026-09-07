# JK Gestão

Aplicação estática publicada no GitHub Pages. `index.html` contém a interface; `app.js` coordena a interface e a sincronização; `data-model.js` contém as regras e a migração idempotente para `meta.schemaVersion = 3`.

## Dados

- `clients`: cadastro único, nome e endereço.
- `offerings`: serviços contratados, vinculados a um cliente, com descrição, frequência, valor e previsão.
- `services`: chave histórica mantida para as **visitas realizadas**, vinculadas a `offeringId` e `clientId`.
- `payments`: recebimentos e estornos, vinculados a uma visita (`serviceId`), serviço contratado (`offeringId`) e cliente.
- `migrationArchive.structureV3`: cópia integral dos dados anteriores e mapas de união. Integra o backup; não é uma segunda lista de cobranças.

A migração não cria visitas a partir de datas do cadastro. Apenas as identidades e duplicidades revisadas são unidas. Serviços e visitas diferentes são preservados. Importações duplicadas que tenham recebido pagamento ativo de valor não zero não são consolidadas automaticamente.

Cada serviço tem seu próprio ciclo quinzenal e agenda. Somente a segunda visita quinzenal gera cobrança. Visitas de serviços diferentes podem ocorrer no mesmo dia; registrar o mesmo serviço duas vezes no mesmo dia é bloqueado. Pagamentos mantêm o valor da visita; editar o cadastro não altera valores históricos.

Gravações usam comparação de `updated_at`, confirmação da resposta do banco e recarga em conflito. Uma falha não confirma a alteração na interface. A proteção `jk_structure_v3_guard` no Supabase rejeita versões antigas e vínculos ausentes. Sua definição está registrada na migração `protect_jk_customer_service_visit_structure` do projeto. Não retornar uma versão anterior do frontend sem planejar compatibilidade com a estrutura 3.

## Verificação

```sh
node tests/regression.cjs
# Opcional: validar uma cópia privada do banco anterior (não adicionar ao Git):
node tests/regression.cjs /caminho/privado/backup-anterior.json
```

Os testes verificam migração, totais, vínculos, independência dos serviços e ciclos, duplicação de atendimentos, pagamentos, estornos, falhas e conflitos de gravação. Dados reais e backups não devem ser adicionados ao repositório público.
