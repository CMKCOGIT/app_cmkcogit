# Modelos de e-mail do Supabase (Authentication > Emails)

Cole o HTML de cada arquivo no modelo correspondente, com o assunto sugerido:

| Modelo no Supabase | Arquivo | Assunto |
|---|---|---|
| Confirm signup | `confirmar-cadastro.html` | Confirme seu cadastro na CMKCOGIT |
| Reset password | `redefinir-senha.html` | Redefina sua senha da CMKCOGIT |
| Password changed (notificações de segurança) | `senha-alterada.html` | Sua senha da CMKCOGIT foi alterada |
| Change email address | `confirmar-troca-email.html` | Confirme seu novo e-mail na CMKCOGIT |
| Email address changed (notificações de segurança) | `email-alterado.html` | O e-mail da sua conta CMKCOGIT foi alterado |

- `{{ .ConfirmationURL }}` e `{{ .Email }}` são preenchidos pelo Supabase.
- A logo vem de `https://app.cmkcogit.com.br/assets/marca/cogit-logo-email-escuro.png`: PNG com o fundo grafite dentro da própria imagem, para aparecer também no modo escuro do celular (o app de e-mail recolore o fundo do topo, mas não mexe na imagem). SVG não aparece no Gmail/Outlook.
- Tudo com tabelas e estilos inline, que é o que os clientes de e-mail aceitam.
