(function () {
  try {
    var t = localStorage.getItem("theme");
    if (!t) t = "light";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
