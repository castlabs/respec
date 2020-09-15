// @ts-check
// Module core/render-biblio
// renders the biblio data pre-processed in core/biblio

import { addId, getIntlData } from "./utils.js";
import { biblio } from "./biblio.js";
import { html } from "./import-maps.js";
import { pub } from "./pubsubhub.js";

export const name = "core/render-biblio";

const localizationStrings = {
  en: {
    info_references: "Informative references",
    norm_references: "Normative references",
    references: "References",
  },
  ko: {
    references: "참조",
  },
  nl: {
    info_references: "Informatieve referenties",
    norm_references: "Normatieve referenties",
    references: "Referenties",
  },
  es: {
    info_references: "Referencias informativas",
    norm_references: "Referencias normativas",
    references: "Referencias",
  },
  ja: {
    info_references: "参照用参考文献",
    norm_references: "規範的参考文献",
    references: "参考文献",
  },
  de: {
    info_references: "Weiterführende Informationen",
    norm_references: "Normen und Spezifikationen",
    references: "Referenzen",
  },
};

const l10n = getIntlData(localizationStrings);

const REF_STATUSES = new Map([
  ["CR", "Candidate Recommendation"],
  ["ED", "Editor's Draft"],
  ["FPWD", "First Public Working Draft"],
  ["LCWD", "Last Call Working Draft"],
  ["NOTE", "Note"],
  ["PER", "Proposed Edited Recommendation"],
  ["PR", "Proposed Recommendation"],
  ["REC", "Recommendation"],
  ["WD", "Working Draft"],
  ["WG-NOTE", "Working Group Note"],
]);

const defaultsReference = Object.freeze({
  authors: [],
  date: "",
  href: "",
  publisher: "",
  status: "",
  title: "",
  etAl: false,
});

const endWithDot = endNormalizer(".");

/** @param {Conf} conf */
export function run(conf) {
  const informs = Array.from(conf.informativeReferences);
  const norms = Array.from(conf.normativeReferences);

  if (!informs.length && !norms.length) return;

  /** @type {HTMLElement} */
  const refSection =
    document.querySelector("section#references") ||
    html`<section id="references"></section>`;

  if (!document.querySelector("section#references > h2")) {
    refSection.prepend(html`<h2>${l10n.references}</h2>`);
  }

  refSection.classList.add("appendix");

  if (norms.length) {
    const sec = createReferencesSection(norms, l10n.norm_references);
    refSection.appendChild(sec);
  }
  if (informs.length) {
    const sec = createReferencesSection(informs, l10n.info_references);
    refSection.appendChild(sec);
  }

  document.body.appendChild(refSection);
}

/**
 * @param {string[]} refs
 * @param {string} title
 * @returns {HTMLElement}
 */
function createReferencesSection(refs, title) {
  const { goodRefs, badRefs } = groupRefs(refs.map(toRefContent));
  const uniqueRefs = getUniqueRefs(goodRefs);

  const refsToShow = uniqueRefs
    .concat(badRefs)
    .sort((a, b) =>
      a.ref.toLocaleLowerCase().localeCompare(b.ref.toLocaleLowerCase())
    );

  const sec = html`<section>
    <h3>${title}</h3>
    <dl class="bibliography">
      ${refsToShow.map(showRef)}
    </dl>
  </section>`;
  addId(sec, "", title);

  const aliases = getAliases(goodRefs);
  decorateInlineReference(uniqueRefs, aliases);
  warnBadRefs(badRefs);

  return sec;
}

/**
 * returns refcontent and unique key for a reference among its aliases
 * and warns about circular references
 * @param {String} ref
 * @typedef {ReturnType<typeof toRefContent>} Ref
 */
function toRefContent(ref) {
  let refcontent = biblio[ref];
  let key = ref;
  const circular = new Set([key]);
  while (refcontent && refcontent.aliasOf) {
    if (circular.has(refcontent.aliasOf)) {
      refcontent = null;
      const msg = `Circular reference in biblio DB between [\`${ref}\`] and [\`${key}\`].`;
      pub("error", msg);
    } else {
      key = refcontent.aliasOf;
      refcontent = biblio[key];
      circular.add(key);
    }
  }
  if (refcontent && !refcontent.id) {
    refcontent.id = ref.toLowerCase();
  }
  return { ref, refcontent };
}

/** @param {Ref[]} refs */
function groupRefs(refs) {
  const goodRefs = [];
  const badRefs = [];
  for (const ref of refs) {
    if (ref.refcontent) {
      goodRefs.push(ref);
    } else {
      badRefs.push(ref);
    }
  }
  return { goodRefs, badRefs };
}

/** @param {Ref[]} refs */
function getUniqueRefs(refs) {
  /** @type {Map<string, Ref>} */
  const uniqueRefs = new Map();
  for (const ref of refs) {
    if (!uniqueRefs.has(ref.refcontent.id)) {
      // the condition ensures that only the first used [[TERM]]
      // shows up in #references section
      uniqueRefs.set(ref.refcontent.id, ref);
    }
  }
  return [...uniqueRefs.values()];
}

/**
 * Render an inline citation
 *
 * @param {String} ref the inline reference.
 * @param {String} [linkText] custom link text
 * @returns HTMLElement
 */
export function renderInlineCitation(ref, linkText) {
  const key = ref.replace(/^(!|\?)/, "");
  const href = `#bib-${key.toLowerCase()}`;
  const text = linkText || key;
  const elem = html`<cite
    ><a class="bibref" href="${href}" data-link-type="biblio">${text}</a></cite
  >`;
  return linkText ? elem : html`[${elem}]`;
}

/**
 * renders a reference
 * @param {Ref} ref
 */
function showRef({ ref, refcontent }) {
  const refId = `bib-${ref.toLowerCase()}`;
  if (refcontent) {
    return html`
      <dt id="${refId}">[${ref}]</dt>
      <dd>${{ html: stringifyReference(refcontent) }}</dd>
    `;
  } else {
    return html`
      <dt id="${refId}">[${ref}]</dt>
      <dd><em class="respec-offending-element">Reference not found.</em></dd>
    `;
  }
}

function endNormalizer(endStr) {
  return str => {
    const trimmed = str.trim();
    const result =
      !trimmed || trimmed.endsWith(endStr) ? trimmed : trimmed + endStr;
    return result;
  };
}

export function wireReference(rawRef, target = "_blank") {
  if (typeof rawRef !== "object") {
    throw new TypeError("Only modern object references are allowed");
  }
  const ref = Object.assign({}, defaultsReference, rawRef);
  const authors = ref.authors.join("; ") + (ref.etAl ? " et al" : "");
  const status = REF_STATUSES.get(ref.status) || ref.status;
  return html.wire(ref)`
    <cite>
      <a
        href="${ref.href}"
        target="${target}"
        rel="noopener noreferrer">
        ${ref.title.trim()}</a>.
    </cite>
    <span class="authors">
      ${endWithDot(authors)}
    </span>
    <span class="publisher">
      ${endWithDot(ref.publisher)}
    </span>
    <span class="pubDate">
      ${endWithDot(ref.date)}
    </span>
    <span class="pubStatus">
      ${endWithDot(status)}
    </span>
  `;
}

/** @param {BiblioData|string} ref */
export function stringifyReference(ref) {
  if (typeof ref === "string") return ref;
  let output = `<cite>${ref.title}</cite>`;

  output = ref.href ? `<a href="${ref.href}">${output}</a>. ` : `${output}. `;

  if (ref.authors && ref.authors.length) {
    output += ref.authors.join("; ");
    if (ref.etAl) output += " et al";
    output += ". ";
  }
  if (ref.publisher) {
    output = `${output} ${endWithDot(ref.publisher)} `;
  }
  if (ref.date) output += `${ref.date}. `;
  if (ref.status) output += `${REF_STATUSES.get(ref.status) || ref.status}. `;
  if (ref.href) output += `URL: <a href="${ref.href}">${ref.href}</a>`;
  return output;
}

/**
 * get aliases for a reference "key"
 */
function getAliases(refs) {
  return refs.reduce((aliases, ref) => {
    const key = ref.refcontent.id;
    const keys = !aliases.has(key)
      ? aliases.set(key, []).get(key)
      : aliases.get(key);
    keys.push(ref.ref);
    return aliases;
  }, new Map());
}

/**
 * fix biblio reference URLs
 * Add title attribute to references
 */
function decorateInlineReference(refs, aliases) {
  refs
    .map(({ ref, refcontent }) => {
      const refUrl = `#bib-${ref.toLowerCase()}`;
      const selectors = aliases
        .get(refcontent.id)
        .map(alias => `a.bibref[href="#bib-${alias.toLowerCase()}"]`)
        .join(",");
      const elems = document.querySelectorAll(selectors);
      return { refUrl, elems, refcontent };
    })
    .forEach(({ refUrl, elems, refcontent }) => {
      elems.forEach(a => {
        a.setAttribute("href", refUrl);
        a.setAttribute("title", refcontent.title);
        a.dataset.linkType = "biblio";
      });
    });
}

/**
 * warn about bad references
 */
function warnBadRefs(badRefs) {
  badRefs.forEach(({ ref }) => {
    const badrefs = [
      ...document.querySelectorAll(
        `a.bibref[href="#bib-${ref.toLowerCase()}"]`
      ),
    ].filter(({ textContent: t }) => t.toLowerCase() === ref.toLowerCase());
    const msg = `Bad reference: [\`${ref}\`] (appears ${badrefs.length} times)`;
    pub("error", msg);
    console.warn("Bad references: ", badrefs);
  });
}
