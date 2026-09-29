// Tema do Agente Jet: Automatico (segue o sistema), Claro ou Escuro.
// A escolha fica no navegador (localStorage 'jet_tema') e vale para o Agente e para a tela de Fornecedores.
// Carregar no <head>, sem defer: aplica o tema antes da pagina aparecer (sem piscar o tema errado).
// Botoes com o atributo data-tema-btn alternam Automatico -> Claro -> Escuro.
(function () {
  var CHAVE = 'jet_tema';
  var ORDEM = ['auto', 'light', 'dark'];
  var ROTULO = { auto: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' };

  function ler() {
    try { var v = localStorage.getItem(CHAVE); return ORDEM.indexOf(v) >= 0 ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function aplicar(tema) {
    var raiz = document.documentElement;
    if (tema === 'auto') raiz.removeAttribute('data-theme'); else raiz.setAttribute('data-theme', tema);
  }
  function atualizarBotoes(tema) {
    var bts = document.querySelectorAll('[data-tema-btn]');
    for (var i = 0; i < bts.length; i++) {
      bts[i].textContent = ROTULO[tema];
      bts[i].title = ROTULO[tema] + '. Clique para trocar (automático segue o sistema)';
      bts[i].setAttribute('data-tema', tema); // em tela estreita o CSS mostra so um icone por tema
    }
  }
  function definir(tema) {
    try { if (tema === 'auto') localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, tema); } catch (e) {}
    aplicar(tema);
    atualizarBotoes(tema);
  }
  function proximo() { definir(ORDEM[(ORDEM.indexOf(ler()) + 1) % ORDEM.length]); }

  aplicar(ler());
  document.addEventListener('DOMContentLoaded', function () {
    atualizarBotoes(ler());
    document.addEventListener('click', function (ev) {
      var alvo = ev.target && ev.target.closest && ev.target.closest('[data-tema-btn]');
      if (alvo) proximo();
    });
  });
  window.jetTema = { ler: ler, definir: definir, proximo: proximo };
})();
