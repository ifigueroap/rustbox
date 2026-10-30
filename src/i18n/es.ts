import { en } from "./en";

type SameShape<T> = {
  [K in keyof T]: T[K] extends string ? string : { one: string; other: string };
};

/** Neutral Latin American Spanish. */
export const es = {
  "common.dismiss": "Descartar",
  "common.close": "Cerrar",
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.saving": "Guardando…",
  "common.add": "Agregar",
  "common.name": "Nombre",
  "common.somethingWrong": "Algo salió mal",

  "settings.appearance": "Apariencia",
  "settings.themeAuto": "Automático",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.language": "Idioma",
  "settings.languageSystem": "Sistema",
  "settings.languageEn": "English",
  "settings.languageEs": "Español",
  "settings.closeToTray": "Cerrar a la bandeja",
  "settings.closeToTrayOn":
    "Al cerrar la ventana, Rustbox se oculta y los servicios siguen en ejecución. Para salir, usa el menú de la bandeja o pulsa Ctrl+Q.",
  "settings.closeToTrayOff":
    "El icono de la bandeja no está disponible, así que cerrar la ventana sale de Rustbox.",
  "settings.autoUpdate": "Buscar actualizaciones automáticamente",
  "settings.autoUpdateHint":
    "Rustbox le pregunta a GitHub si hay una versión más nueva. No se instala nada hasta que tú lo elijas, y no se envía ninguna cuenta ni identificador.",
  "settings.workspaceRail": "Barra de espacios",
  "settings.workspaceRailHint": "Muestra la barra de espacios junto a la barra lateral.",
  "settings.workspaceRailNeedsSecond":
    "La barra de espacios aparece cuando hay un segundo espacio de trabajo.",
  "settings.newWorkspace": "Nuevo espacio de trabajo",
  "settings.addService": "Agregar servicio",

  "brand.showDashboard": "Mostrar el escritorio de rustbox",
  "brand.title": "rustbox — {name}",

  "nav.workspaces": "Espacios de trabajo",
  "nav.services": "Servicios",
  "nav.switchWorkspace": "Cambiar de espacio de trabajo — {name}",

  "sidebar.expand": "Expandir la barra lateral",
  "sidebar.collapse": "Contraer la barra lateral",
  "sidebar.addService": "Agregar un servicio",
  "sidebar.hideRail": "Ocultar la barra de espacios",
  "sidebar.showRail": "Mostrar la barra de espacios",
  "sidebar.opening": "Abriendo {name}",

  "dnd.label": "No molestar",
  "dnd.on": "No molestar está activado. Haz clic para desactivarlo.",
  "dnd.off": "Pausa el sonido y las notificaciones de todos los servicios.",

  "desk.eyebrow": "escritorio",
  "desk.workspaceEyebrow": "espacio de trabajo",
  "desk.ledeAll": "Todos los servicios de esta ventana, cada uno con su propia sesión.",
  "desk.emptyShort": "Todavía no hay servicios en este espacio de trabajo.",
  "desk.ledeCount": "{services}, cada uno con su propia sesión.",
  "desk.scopeOnly": "Solo {name}",
  "desk.scopeAll": "Todos los servicios",
  "desk.scopeOnlyHint": "Mostrar solo los servicios de este espacio de trabajo.",
  "desk.scopeAllHint": "Mostrar todos los servicios, de todos los espacios de trabajo.",
  "desk.emptyNamed":
    "Todavía no hay servicios en {name}. Agrega uno aquí, incluye servicios de otro espacio de trabajo o mira todos a la vez.",
  "desk.emptyPlain": "Todavía no hay servicios. Agrega uno para empezar.",
  "desk.showAll": "Mostrar todos los servicios",
  "desk.thisWorkspace": "este espacio de trabajo",

  "count.servicesInWorkspace": {
    one: "{count} servicio en este espacio de trabajo",
    other: "{count} servicios en este espacio de trabajo",
  },
  "count.workspaceSummary": {
    one: "{name} — {count} servicio",
    other: "{name} — {count} servicios",
  },
  "count.unread": {
    one: "{shown} sin leer",
    other: "{shown} sin leer",
  },
  "count.alreadyEverywhere": {
    one: "{count} servicio ya aparece en todos los espacios de trabajo y no se lista aquí.",
    other: "{count} servicios ya aparecen en todos los espacios de trabajo y no se listan aquí.",
  },

  "unread.none": "Nada sin leer",

  "card.open": "Abrir",
  "card.edit": "Editar",
  "card.remove": "Quitar",
  "card.openNamed": "Abrir {name}",
  "card.allWorkspaces": "Todos los espacios de trabajo",

  "service.removeConfirm": "¿Quitar {name}? Se eliminará su sesión guardada.",
  "service.name": "Nombre",
  "service.url": "URL",
  "service.icon": "Icono",
  "service.iconPlaceholder": "URL o emoji",
  "service.chooseImage": "Elegir imagen",
  "service.usePreset": "Usar el predefinido o el favicon",
  "service.iconHint":
    "PNG, SVG, ICO, JPG o WebP. Rustbox copia la imagen a su propia carpeta de datos.",
  "service.accent": "Color de acento",
  "service.accentAria": "Color de acento",
  "service.accentHex": "Color de acento en hexadecimal",
  "service.brandDefault": "Usar el color de la marca",
  "service.accentHint":
    "Se usa para el resaltado de la barra lateral y la letra de respaldo. Un icono a todo color conserva sus colores.",
  "service.chromeUa": "Usar un agente de usuario de Chrome",
  "service.customUa": "Agente de usuario personalizado",
  "service.customUaPlaceholder": "Déjalo en blanco para usar la cadena de Chrome integrada",
  "service.workspaces": "Espacios de trabajo",
  "service.membershipHint":
    "Elige cada espacio de trabajo en el que aparece este servicio. Sigue siendo un solo servicio con una sola sesión.",
  "service.allWorkspaces": "Todos los espacios de trabajo",
  "service.membershipError":
    "Elige al menos un espacio de trabajo, o marca Todos los espacios de trabajo, para que este servicio no quede oculto.",
  "service.iconTooBig": "El archivo del icono debe pesar menos de 1,5 MB.",
  "service.soundOff": "Sonido desactivado",
  "service.notificationsOff": "Notificaciones desactivadas",
  "service.silenced": "Silenciado por No molestar del espacio de trabajo",
  "service.menuSound": "Sonido",
  "service.menuNotifications": "Notificaciones",
  "service.menuReload": "Recargar",
  "service.menuCopyUrl": "Copiar URL",
  "service.menuOpenBrowser": "Abrir en el navegador",

  "manager.eyebrow": "servicios",
  "manager.title": "Agregar un servicio",
  "manager.presets": "Predefinidos",
  "manager.custom": "Servicio personalizado",
  "manager.addCustom": "Agregar servicio personalizado",
  "manager.serverUrl": "URL del servidor de {name}",
  "manager.serverUrlLabel": "URL del servidor",
  "manager.config": "Configuración: {path}",
  "manager.sessions": "Sesiones: {path}",
  "manager.uaHint": "Agente de usuario de Chrome integrado: {agent}",

  "editor.eyebrow": "servicio",
  "editor.title": "Editar servicio",

  "workspace.eyebrow": "espacio de trabajo",
  "workspace.new": "Nuevo espacio de trabajo",
  "workspace.renameTitle": "Cambiar nombre de {name}",
  "workspace.editTitle": "Editar {name}",
  "workspace.fallbackPreview": "Espacio de trabajo",
  "workspace.icon": "Icono",
  "workspace.iconPlaceholder": "Emoji, URL, o déjalo en blanco para usar la inicial",
  "workspace.chooseImage": "Elegir imagen",
  "workspace.useInitial": "Usar inicial",
  "workspace.iconHint":
    "Un emoji como 💼, la URL de una imagen, o un archivo copiado a la carpeta de datos de Rustbox.",
  "workspace.accent": "Color de acento",
  "workspace.accentAria": "Color de acento del espacio de trabajo",
  "workspace.accentHex": "Color de acento del espacio de trabajo en hexadecimal",
  "workspace.accentHint": "Se usa para el resaltado de la barra y la letra de respaldo.",
  "workspace.includeLegend": "Incluir servicios existentes",
  "workspace.includeOptional": "(opcional)",
  "workspace.includeHint":
    "Los servicios marcados también se agregan a este espacio de trabajo. No se quitan de los espacios en los que ya están.",
  "workspace.keepOne": "Conserva al menos un espacio de trabajo.",
  "workspace.deleteConfirm":
    "¿Eliminar el espacio de trabajo {name}?\n\nNo se elimina ningún servicio ni sesión. Los servicios que solo están en este espacio pasan a {fallback}.",
  "workspace.first": "el primer espacio de trabajo",
  "workspace.menuRename": "Cambiar nombre…",
  "workspace.menuEdit": "Editar icono y color…",
  "workspace.menuDndOff": "Desactivar No molestar",
  "workspace.menuMoveUp": "Subir",
  "workspace.menuMoveDown": "Bajar",
  "workspace.menuDelete": "Eliminar espacio de trabajo…",

  "include.open": "Incluir servicios existentes…",
  "include.title": "Incluir servicios existentes",
  "include.titleNamed": "Incluir servicios en {name}",
  "include.hint":
    "Los servicios marcados también aparecen en este espacio de trabajo. Conservan su sesión y siguen en todos los espacios en los que ya están.",
  "include.pickFirst": "Elige un espacio de trabajo primero.",
  "include.alreadyIn": "Todos los servicios ya están en {name}.",
  "include.add": "Agregar al espacio de trabajo",
  "include.adding": "Agregando…",

  "updates.checkNow": "Buscar ahora",
  "updates.checkingShort": "Buscando…",
  "updates.checking": "Buscando actualizaciones…",
  "updates.failed": "No se pudo buscar actualizaciones.",
  "updates.upToDate": "Al día",
  "updates.lastNever": "Última comprobación: nunca",
  "updates.lastChecked": "Última comprobación: {when}",
  "updates.available": "Actualización disponible",
  "updates.availableVersion": "Actualización disponible: v{version}",
  "updates.checkForUpdates": "Buscar actualizaciones",
  "updates.eyebrow": "actualización",
  "updates.versionLine": "La versión {version} está disponible. Estás en la {current}.",
  "updates.noNotes": "No hay notas de la versión.",
  "updates.manual":
    "Esta copia no puede instalar actualizaciones por sí misma. Abre la página de la versión y reemplázala cuando quieras. Los servicios y las sesiones se quedan donde están.",
  "updates.download": "Descargar e instalar",
  "updates.downloading": "Descargando…",
  "updates.restart": "Reiniciar para actualizar",
  "updates.later": "Más tarde",
  "updates.skip": "Omitir esta versión",
  "updates.openRelease": "Abrir la página de la versión",

  "boot.viteOnly":
    "Abre esta ventana desde la aplicación Rustbox. La página de Vite por sí sola no puede alojar los webviews de los servicios.",

  "render.workspaceRail": "barra de espacios",
  "render.workspaceSwitcher": "selector de espacios",
  "render.sidebar": "barra lateral",
  "render.desk": "escritorio",
  "render.serviceDialog": "diálogo de servicios",
} satisfies SameShape<typeof en>;
