/* VFIC bilingual layer — English (default) + Tagalog toggle. Shared by all pages. */
(function () {
  const DICT = {
    en: {
      /* brand / chrome */
      'brand.company': 'Victors Freight International Corporation',
      'brand.short': 'VFIC',
      'brand.slogan': '“ Chosen to Deliver ”',
      'brand.tagline': 'Balikbayan Box & Cargo — Worldwide to the Philippines',
      'shell.ops': 'Box Operations',
      'shell.staffPortal': 'Staff Portal',
      'shell.language': 'Language',
      'shell.viewSite': 'View public site',

      /* nav */
      'nav.dashboard': 'Dashboard', 'nav.shipments': 'Shipments', 'nav.boxes': 'Boxes',
      'nav.containers': 'Containers', 'nav.warehouse': 'Warehouse', 'nav.trips': 'Trips',
      'nav.returns': 'Returns', 'nav.customers': 'Customers', 'nav.sms': 'SMS',
      'nav.reports': 'Reports', 'nav.scan': 'Scan', 'nav.admin': 'Admin',
      'nav.section.ops': 'Operations', 'nav.section.people': 'People & Comms', 'nav.section.system': 'System',

      /* common */
      'common.search': 'Search', 'common.print': 'Print', 'common.save': 'Save', 'common.cancel': 'Cancel',
      'common.add': 'Add', 'common.remove': 'Remove', 'common.update': 'Update', 'common.back': 'Back',
      'common.logout': 'Log out', 'common.login': 'Log in', 'common.email': 'Email', 'common.password': 'Password',
      'common.loading': 'Loading…', 'common.none': 'None', 'common.help': 'Need help?',

      /* login */
      'login.title': 'Staff Sign In', 'login.subtitle': 'Box Operations Portal',
      'login.demo': 'Demo accounts', 'login.password_is': 'password',
      'login.track': 'Track a box', 'login.home': 'Back to home',

      /* statuses */
      'status.CREATED': 'Created', 'status.RECEIVED_ORIGIN': 'Received (origin)',
      'status.LOADED_CONTAINER': 'Loaded in container', 'status.IN_TRANSIT': 'In transit',
      'status.ARRIVED_PORT': 'Arrived (PH port)', 'status.RECEIVED_WAREHOUSE': 'Received (warehouse)',
      'status.SORTED': 'Sorted', 'status.ASSIGNED': 'Assigned to trip', 'status.LOADED_TRUCK': 'Loaded on truck',
      'status.OUT_FOR_DELIVERY': 'Out for delivery', 'status.DELIVERED': 'Delivered',
      'status.RETURNED': 'Returned', 'status.CANCELLED': 'Cancelled',

      /* friendly public statuses */
      'pub.CREATED': 'Registered', 'pub.RECEIVED_ORIGIN': 'Received at origin',
      'pub.LOADED_CONTAINER': 'Loaded in container', 'pub.IN_TRANSIT': 'On the way to the Philippines',
      'pub.ARRIVED_PORT': 'Arrived in the Philippines', 'pub.RECEIVED_WAREHOUSE': 'Received at warehouse',
      'pub.SORTED': 'Sorted for delivery region', 'pub.ASSIGNED': 'Scheduled for delivery',
      'pub.LOADED_TRUCK': 'Loaded on delivery truck', 'pub.OUT_FOR_DELIVERY': 'Out for delivery',
      'pub.DELIVERED': 'Delivered', 'pub.RETURNED': 'Delivery attempted — returned to warehouse',
      'pub.CANCELLED': 'Cancelled',

      /* services */
      'service.DOOR_TO_DOOR': 'Door to Door', 'service.PORT_TO_PORT': 'Port to Port',
      'service.DOOR_TO_PORT': 'Door to Port', 'service.DOOR_TO_AIRPORT': 'Door to Airport',

      /* dashboard */
      'dash.title': 'Operations Dashboard', 'dash.totalBoxes': 'Total boxes',
      'dash.returns': 'Returns queue', 'dash.unpaid': 'Unpaid shipments', 'dash.pipeline': 'Pipeline',
      'dash.inTransit': 'Containers in transit', 'dash.activeTrips': 'Active trips', 'dash.recentSms': 'Recent SMS',

      /* landing */
      'land.nav.services': 'Services', 'land.nav.track': 'Tracking', 'land.nav.how': 'How it works', 'land.nav.send': 'Send a box', 'land.nav.contact': 'Contact', 'land.nav.login': 'Staff Login',
      'land.hero.line1': 'We deliver your', 'land.hero.line2': 'Balikbayan Boxes',
      'land.hero.kicker': 'Worldwide to the Philippines · Since day one',
      'land.hero.title': 'Your balikbayan box, safely home.',
      'land.hero.sub': 'Victors Freight International Corporation ships your boxes and personal cargo from anywhere in the world to every corner of the Philippines — door to door, tracked every step of the way.',
      'land.hero.ctaTrack': 'Track your box', 'land.hero.ctaSend': 'Send a box online',
      'land.stat.boxes': 'Boxes delivered', 'land.stat.years': 'Years of service', 'land.stat.regions': 'Regions covered', 'land.stat.tracking': 'Live tracking',
      'land.services.title': 'What we do', 'land.services.sub': 'One trusted partner for every kind of shipment home.',
      'land.svc.sea.t': 'Sea Freight', 'land.svc.sea.d': 'Cost-effective ocean shipping and container consolidation for balikbayan boxes and personal cargo.',
      'land.svc.air.t': 'Air Freight', 'land.svc.air.d': 'Fast air cargo when your package needs to arrive in days, not weeks.',
      'land.svc.door.t': 'Door to Door', 'land.svc.door.d': 'We pick up abroad and deliver right to the receiver’s doorstep anywhere in the Philippines.',
      'land.svc.customs.t': 'Customs Brokerage', 'land.svc.customs.d': 'FTEB-accredited handling of documentation and clearance so your box moves without delay.',
      'land.how.title': 'How it works', 'land.how.sub': 'From your hands to theirs in four simple steps.',
      'land.how.1t': 'Pack & book', 'land.how.1d': 'Fill out the receiving form online or at our branch and get your box number.',
      'land.how.2t': 'We consolidate', 'land.how.2d': 'Your box is loaded into a container and shipped to the Philippines.',
      'land.how.3t': 'Arrival & sorting', 'land.how.3d': 'On arrival we strip, sort by region, and schedule delivery.',
      'land.how.4t': 'Delivered home', 'land.how.4d': 'We deliver to the doorstep with photo proof and an SMS to both sender and receiver.',
      'land.track.title': 'Where is my box?', 'land.track.sub': 'Track any shipment with your box number, or scan the QR code on your label.',
      'land.track.btn': 'Open box tracking',
      'land.send.title': 'Sending a box?', 'land.send.sub': 'Fill out our receiving form online before you drop off — it only takes a few minutes.',
      'land.send.btn': 'Fill out receiving form',
      'land.contact.title': 'Get in touch', 'land.contact.head': 'Head Office',
      'land.contact.phone': 'Phone', 'land.contact.email': 'Email', 'land.contact.hours': 'Office hours', 'land.contact.hoursVal': 'Mon–Fri, 8:30 AM – 5:30 PM',
      'land.footer.rights': 'All rights reserved.', 'land.footer.disclaimer': 'Demo system built to VFIC’s operations specification.',

      /* public track page */
      'track.title': 'Track your Balikbayan Box',
      'track.sub': 'Enter your box number and the last 4 digits of the receiver’s phone — or scan the QR code on your box label.',
      'track.boxNo': 'Box number', 'track.phone4': 'Last 4 digits of receiver’s phone',
      'track.btn': 'Track', 'track.needBoth': 'Please enter both the box number and the last 4 digits of the receiver’s phone.',
      'track.loading': 'Looking up your box…', 'track.timeline': 'Status timeline',
      'track.for': 'For', 'track.help': 'Need help? Contact VFIC support at',
      'track.boxLabel': 'Box number', 'track.unreachable': 'Could not reach the tracking service. Please try again.',

      /* public intake form */
      'intake.title': 'Balikbayan Box Receiving Form',
      'intake.sub': 'Fill this up online instead of on paper. A VFIC agent will review your details.',
      'intake.senderSec': 'Your information (sender)',
      'intake.fullName': 'Full name', 'intake.phone': 'Phone (primary)', 'intake.altPhone': 'Phone (alternate)',
      'intake.email': 'Email', 'intake.address': 'Your address', 'intake.city': 'City', 'intake.province': 'Province/State',
      'intake.country': 'Country', 'intake.sendingFrom': 'Sending from (branch/city)', 'intake.serviceType': 'Service type',
      'intake.passport': 'Passport / government ID (photo or scan)', 'intake.passportNote': 'Required — VFIC needs a soft copy of your ID on file for this shipment.',
      'intake.boxesSec': 'Your box(es)', 'intake.box': 'Box',
      'intake.rName': 'Receiver full name', 'intake.rPhone': 'Receiver phone', 'intake.rAlt': 'Receiver alternate phone',
      'intake.region': 'Region', 'intake.rAddress': 'Receiver address (house/street, barangay)', 'intake.rCity': 'City/Municipality',
      'intake.landmark': 'Landmark (helps the driver find the address)', 'intake.size': 'Box size', 'intake.weight': 'Approx. weight (kg)',
      'intake.contents': 'Declared contents (summary)', 'intake.instructions': 'Special instructions',
      'intake.packing': 'Itemized packing list', 'intake.itemDesc': 'Item description (e.g. canned goods)', 'intake.qty': 'Qty',
      'intake.addItem': 'Add item', 'intake.addBox': 'Add another box', 'intake.submit': 'Submit',
      'intake.after': 'After submitting, you’ll get a reference number — bring or quote it when you drop off your box(es), or a VFIC agent will contact you.',
      'intake.doneTitle': 'Submitted!', 'intake.doneRef': 'Your reference number is:',
      'intake.doneNote': 'Please keep this number. Show or quote it to VFIC staff when you drop off your box(es), or when a VFIC agent contacts you to confirm details and pricing.',
      'intake.donePrint': 'Print this confirmation',
      'intake.errPassport': 'Please attach a photo or scan of your passport/government ID.',
      'intake.errSender': 'Please enter your full name and phone number.',
      'intake.errBox': 'Every box needs a receiver name, phone, address, and city.',
      'intake.errAddBox': 'Please add at least one box.'
    },

    tl: {
      'brand.company': 'Victors Freight International Corporation',
      'brand.short': 'VFIC',
      'brand.slogan': '“ Chosen to Deliver ”',
      'brand.tagline': 'Balikbayan Box at Kargamento — Buong Mundo Papuntang Pilipinas',
      'shell.ops': 'Operasyon ng Kahon',
      'shell.staffPortal': 'Portal ng Kawani',
      'shell.language': 'Wika',
      'shell.viewSite': 'Tingnan ang public site',

      'nav.dashboard': 'Dashboard', 'nav.shipments': 'Mga Padala', 'nav.boxes': 'Mga Kahon',
      'nav.containers': 'Mga Container', 'nav.warehouse': 'Bodega', 'nav.trips': 'Mga Biyahe',
      'nav.returns': 'Mga Naibalik', 'nav.customers': 'Mga Kustomer', 'nav.sms': 'SMS',
      'nav.reports': 'Mga Ulat', 'nav.scan': 'I-scan', 'nav.admin': 'Admin',
      'nav.section.ops': 'Operasyon', 'nav.section.people': 'Mga Tao at Komunikasyon', 'nav.section.system': 'Sistema',

      'common.search': 'Maghanap', 'common.print': 'I-print', 'common.save': 'I-save', 'common.cancel': 'Kanselahin',
      'common.add': 'Magdagdag', 'common.remove': 'Alisin', 'common.update': 'I-update', 'common.back': 'Bumalik',
      'common.logout': 'Mag-log out', 'common.login': 'Mag-log in', 'common.email': 'Email', 'common.password': 'Password',
      'common.loading': 'Naglo-load…', 'common.none': 'Wala', 'common.help': 'Kailangan ng tulong?',

      'login.title': 'Pag-sign In ng Kawani', 'login.subtitle': 'Portal ng Operasyon ng Kahon',
      'login.demo': 'Demo na account', 'login.password_is': 'password',
      'login.track': 'I-track ang kahon', 'login.home': 'Bumalik sa home',

      'status.CREATED': 'Nairehistro', 'status.RECEIVED_ORIGIN': 'Natanggap (pinagmulan)',
      'status.LOADED_CONTAINER': 'Nakakarga sa container', 'status.IN_TRANSIT': 'Nasa biyahe',
      'status.ARRIVED_PORT': 'Dumating (PH pantalan)', 'status.RECEIVED_WAREHOUSE': 'Natanggap (bodega)',
      'status.SORTED': 'Nabukod', 'status.ASSIGNED': 'Nakatalaga sa biyahe', 'status.LOADED_TRUCK': 'Nakakarga sa truck',
      'status.OUT_FOR_DELIVERY': 'Ipinapadala na', 'status.DELIVERED': 'Naihatid',
      'status.RETURNED': 'Naibalik', 'status.CANCELLED': 'Kinansela',

      'pub.CREATED': 'Nairehistro', 'pub.RECEIVED_ORIGIN': 'Natanggap sa pinagmulan',
      'pub.LOADED_CONTAINER': 'Nakakarga na sa container', 'pub.IN_TRANSIT': 'Papunta na sa Pilipinas',
      'pub.ARRIVED_PORT': 'Dumating na sa Pilipinas', 'pub.RECEIVED_WAREHOUSE': 'Natanggap sa bodega',
      'pub.SORTED': 'Nabukod ayon sa rehiyon', 'pub.ASSIGNED': 'Nakaiskedyul para ihatid',
      'pub.LOADED_TRUCK': 'Nakakarga na sa truck', 'pub.OUT_FOR_DELIVERY': 'Ipinapadala na ngayon',
      'pub.DELIVERED': 'Naihatid na', 'pub.RETURNED': 'Sinubukang ihatid — ibinalik sa bodega',
      'pub.CANCELLED': 'Kinansela',

      'service.DOOR_TO_DOOR': 'Bahay hanggang Bahay', 'service.PORT_TO_PORT': 'Pantalan hanggang Pantalan',
      'service.DOOR_TO_PORT': 'Bahay hanggang Pantalan', 'service.DOOR_TO_AIRPORT': 'Bahay hanggang Paliparan',

      'dash.title': 'Dashboard ng Operasyon', 'dash.totalBoxes': 'Kabuuang kahon',
      'dash.returns': 'Pila ng naibalik', 'dash.unpaid': 'Hindi pa bayad na padala', 'dash.pipeline': 'Daloy',
      'dash.inTransit': 'Mga container sa biyahe', 'dash.activeTrips': 'Aktibong biyahe', 'dash.recentSms': 'Kamakailang SMS',

      'land.nav.services': 'Serbisyo', 'land.nav.track': 'Tracking', 'land.nav.how': 'Paano gumagana', 'land.nav.send': 'Magpadala', 'land.nav.contact': 'Kontak', 'land.nav.login': 'Login ng Kawani',
      'land.hero.line1': 'Inihahatid namin ang inyong', 'land.hero.line2': 'Balikbayan Boxes',
      'land.hero.kicker': 'Buong mundo papuntang Pilipinas · Maaasahan',
      'land.hero.title': 'Ang inyong balikbayan box, ligtas na nakauwi.',
      'land.hero.sub': 'Ipinapadala ng Victors Freight International Corporation ang inyong mga kahon at personal na kargamento mula saanman sa mundo patungo sa bawat sulok ng Pilipinas — mula pintuan hanggang pintuan, may tracking sa bawat hakbang.',
      'land.hero.ctaTrack': 'I-track ang kahon', 'land.hero.ctaSend': 'Magpadala online',
      'land.stat.boxes': 'Naihatid na kahon', 'land.stat.years': 'Taong serbisyo', 'land.stat.regions': 'Saklaw na rehiyon', 'land.stat.tracking': 'Live na tracking',
      'land.services.title': 'Ano ang ginagawa namin', 'land.services.sub': 'Isang maaasahang partner para sa bawat uri ng padala pauwi.',
      'land.svc.sea.t': 'Sea Freight', 'land.svc.sea.d': 'Abot-kayang paglalayag at pagsasama-sama ng container para sa balikbayan box at personal na kargamento.',
      'land.svc.air.t': 'Air Freight', 'land.svc.air.d': 'Mabilis na air cargo kapag kailangang dumating ang padala sa loob ng ilang araw.',
      'land.svc.door.t': 'Bahay hanggang Bahay', 'land.svc.door.d': 'Kinukuha namin sa abroad at inihahatid mismo sa pintuan ng tatanggap saanman sa Pilipinas.',
      'land.svc.customs.t': 'Customs Brokerage', 'land.svc.customs.d': 'FTEB-accredited na paghawak ng dokumento at clearance para walang antala ang inyong kahon.',
      'land.how.title': 'Paano ito gumagana', 'land.how.sub': 'Mula sa inyong kamay hanggang sa kanila sa apat na simpleng hakbang.',
      'land.how.1t': 'Mag-empake at mag-book', 'land.how.1d': 'Sagutan ang receiving form online o sa aming branch at makuha ang box number.',
      'land.how.2t': 'Pagsasama-sama', 'land.how.2d': 'Ikakarga ang inyong kahon sa container at ipapadala sa Pilipinas.',
      'land.how.3t': 'Pagdating at pagbukod', 'land.how.3d': 'Pagdating, ibinababa, ibinubukod ayon sa rehiyon, at iniiskedyul para ihatid.',
      'land.how.4t': 'Naihatid pauwi', 'land.how.4d': 'Inihahatid sa pintuan na may larawang patunay at SMS sa nagpadala at tatanggap.',
      'land.track.title': 'Nasaan ang aking kahon?', 'land.track.sub': 'I-track ang anumang padala gamit ang box number, o i-scan ang QR code sa inyong label.',
      'land.track.btn': 'Buksan ang tracking',
      'land.send.title': 'Magpapadala ng kahon?', 'land.send.sub': 'Sagutan ang aming receiving form online bago mag-drop off — ilang minuto lang.',
      'land.send.btn': 'Sagutan ang receiving form',
      'land.contact.title': 'Makipag-ugnayan', 'land.contact.head': 'Punong Tanggapan',
      'land.contact.phone': 'Telepono', 'land.contact.email': 'Email', 'land.contact.hours': 'Oras ng opisina', 'land.contact.hoursVal': 'Lun–Biy, 8:30 AM – 5:30 PM',
      'land.footer.rights': 'Lahat ng karapatan ay nakalaan.', 'land.footer.disclaimer': 'Demo na sistema na ginawa ayon sa operations spec ng VFIC.',

      'track.title': 'I-track ang inyong Balikbayan Box',
      'track.sub': 'Ilagay ang box number at ang huling 4 na digit ng telepono ng tatanggap — o i-scan ang QR code sa label ng inyong kahon.',
      'track.boxNo': 'Box number', 'track.phone4': 'Huling 4 na digit ng telepono ng tatanggap',
      'track.btn': 'I-track', 'track.needBoth': 'Pakilagay ang box number at ang huling 4 na digit ng telepono ng tatanggap.',
      'track.loading': 'Hinahanap ang inyong kahon…', 'track.timeline': 'Takbo ng status',
      'track.for': 'Para kay', 'track.help': 'Kailangan ng tulong? Tawagan ang VFIC support sa',
      'track.boxLabel': 'Box number', 'track.unreachable': 'Hindi maabot ang tracking service. Pakisubukan muli.',

      'intake.title': 'Balikbayan Box Receiving Form',
      'intake.sub': 'Sagutan ito online sa halip na papel. Susuriin ng VFIC agent ang inyong detalye.',
      'intake.senderSec': 'Inyong impormasyon (nagpadala)',
      'intake.fullName': 'Buong pangalan', 'intake.phone': 'Telepono (pangunahin)', 'intake.altPhone': 'Telepono (alternatibo)',
      'intake.email': 'Email', 'intake.address': 'Inyong address', 'intake.city': 'Lungsod', 'intake.province': 'Probinsya/Estado',
      'intake.country': 'Bansa', 'intake.sendingFrom': 'Nagpapadala mula sa (branch/lungsod)', 'intake.serviceType': 'Uri ng serbisyo',
      'intake.passport': 'Pasaporte / government ID (larawan o scan)', 'intake.passportNote': 'Kailangan — kailangan ng VFIC ng soft copy ng inyong ID para sa padalang ito.',
      'intake.boxesSec': 'Inyong kahon', 'intake.box': 'Kahon',
      'intake.rName': 'Buong pangalan ng tatanggap', 'intake.rPhone': 'Telepono ng tatanggap', 'intake.rAlt': 'Alternatibong telepono ng tatanggap',
      'intake.region': 'Rehiyon', 'intake.rAddress': 'Address ng tatanggap (bahay/kalye, barangay)', 'intake.rCity': 'Lungsod/Munisipyo',
      'intake.landmark': 'Palatandaan (tutulong sa driver na mahanap ang address)', 'intake.size': 'Laki ng kahon', 'intake.weight': 'Tinatayang bigat (kg)',
      'intake.contents': 'Nakasaad na laman (buod)', 'intake.instructions': 'Espesyal na tagubilin',
      'intake.packing': 'Detalyadong listahan ng laman', 'intake.itemDesc': 'Deskripsyon ng item (hal. de-lata)', 'intake.qty': 'Dami',
      'intake.addItem': 'Magdagdag ng item', 'intake.addBox': 'Magdagdag ng kahon', 'intake.submit': 'I-submit',
      'intake.after': 'Pagkatapos i-submit, may makukuha kayong reference number — dalhin o banggitin ito kapag naghatid ng kahon, o kokontakin kayo ng VFIC agent.',
      'intake.doneTitle': 'Naipasa na!', 'intake.doneRef': 'Ang inyong reference number ay:',
      'intake.doneNote': 'Pakitago ang numerong ito. Ipakita o banggitin ito sa kawani ng VFIC pagdating sa drop off, o kapag kinontak kayo para kumpirmahin ang detalye at presyo.',
      'intake.donePrint': 'I-print ang kumpirmasyon',
      'intake.errPassport': 'Paki-attach ang larawan o scan ng inyong pasaporte/government ID.',
      'intake.errSender': 'Pakilagay ang inyong buong pangalan at numero ng telepono.',
      'intake.errBox': 'Bawat kahon ay kailangan ng pangalan ng tatanggap, telepono, address, at lungsod.',
      'intake.errAddBox': 'Pakidagdag ng kahit isang kahon.'
    }
  };

  let lang = 'en';
  try { lang = localStorage.getItem('vfic_lang') === 'tl' ? 'tl' : 'en'; } catch (e) {}
  const listeners = [];

  function t(key, fallback) {
    const d = DICT[lang] || DICT.en;
    if (d[key] != null) return d[key];
    if (DICT.en[key] != null) return DICT.en[key];
    return fallback != null ? fallback : key;
  }
  function getLang() { return lang; }
  function setLang(l) {
    lang = l === 'tl' ? 'tl' : 'en';
    try { localStorage.setItem('vfic_lang', lang); } catch (e) {}
    applyStatic(document);
    listeners.forEach(fn => { try { fn(lang); } catch (e) {} });
  }
  function onChange(fn) { listeners.push(fn); }
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    try { document.documentElement.lang = lang; } catch (e) {}
  }
  // Small inline language toggle (returns HTML); pass a JS expression string to run after switching.
  function toggleHtml(after) {
    const cb = after || '';
    return `<div class="lang-toggle" role="group" aria-label="Language">
      <button type="button" class="lang-btn${lang === 'en' ? ' active' : ''}" onclick="VI.setLang('en');${cb}">EN</button>
      <button type="button" class="lang-btn${lang === 'tl' ? ' active' : ''}" onclick="VI.setLang('tl');${cb}">TL</button>
    </div>`;
  }

  window.VI = { t, getLang, setLang, onChange, applyStatic, toggleHtml, DICT };
  window.t = t;
  document.addEventListener('DOMContentLoaded', () => applyStatic(document));
})();
