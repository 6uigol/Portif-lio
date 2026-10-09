# Portfólio — Guilherme Lima das Chagas

Site estático (HTML, CSS e JavaScript puro) com os projetos salvos no **Firebase Firestore**.
Não há variáveis de ambiente nem chaves secretas: a configuração web do Firebase é pública
e a segurança fica nas regras do Firestore.

## Estrutura

```
index.html                     página única
firebase/firestore.rules       regras do Firestore (validam a senha do dia no servidor)
assets/css/style.css           estilos
assets/js/firebase-config.js   configuração web do Firebase (pública)
assets/js/projects-default.js  projetos padrão (usados se o Firestore estiver vazio/fora do ar)
assets/js/store.js             leitura/escrita no Firestore
assets/js/game.js              jogo "Galáxia de Projetos" (canvas)
assets/js/admin.js             área restrita ("É você, Guilherme?")
assets/js/main.js              navegação, cards, modais, jogo e troca automática da formação
assets/docs/                   currículo para download
assets/img/                    favicon
```

## Rodando localmente

```bash
npx serve .
```

## Área restrita

O botão **"É você, Guilherme?"** no rodapé pede a senha do dia:
`(dia × 100 + mês) + 2003`, no horário de Brasília. Ex.: 08/10 → `810 + 2003 = 2813`.

A senha é conferida pelas regras do Firestore — a fórmula não aparece no JavaScript do site.
Ninguém consegue editar os projetos sem ela, nem ler as senhas usadas.

## Currículo

No painel, a área **Currículo** aceita PDF ou Word (até 5 MB) e substitui o arquivo que os
visitantes baixam. Ele fica salvo no Firestore (coleção `files`), sem usar o Firebase Storage,
que exige plano pago. Se nenhum for enviado, o site usa `assets/docs/Curriculo_Guilherme_Chagas.docx`.

## Arquivos dos projetos (APK, PDF...)

No formulário do projeto dá para anexar um arquivo de até 50 MB (APK, PDF, Word ou ZIP).
O visitante vê "Baixar APK"/"Baixar arquivo" no card e nos detalhes do projeto.
Projetos com APK aparecem também na seção **Downloads** (que só é exibida quando existe algum APK).
Os arquivos ficam no Firestore (`files/{id}`), divididos em partes. No plano gratuito cabe 1 GB no total,
e cada download de um APK de 40 MB gasta ~60 leituras (o limite grátis é 50 mil leituras por dia).

## Jogo

A Galáxia de Projetos mostra no máximo 7 planetas, sorteados a cada visita.
O limite fica em `MAX_PLANETS`, em `assets/js/main.js`.

## Alterando as regras

Edite `firebase/firestore.rules` e cole no Firebase Console → Firestore Database → Regras → Publicar.

## Formação

Até 31/12/2027 o site diz "cursando Engenharia de Computação"; a partir de 01/01/2028 passa a
dizer "Engenheiro de Computação" sozinho. A data fica em `GRADUATION`, em `assets/js/main.js`.

## Segurança

**Nunca** coloque no projeto o arquivo `*-firebase-adminsdk-*.json` (chave de conta de serviço).
Ele dá acesso total ao Firebase e o site não precisa dele.
