(function () {
  "use strict";

  var INTERVAL_MS = 5000;
  var root = document.getElementById("carousel");
  if (!root) {
    return;
  }

  var slides = root.querySelectorAll(".slide");
  var dotsBox = root.querySelector(".carousel__dots");
  var prev = root.querySelector(".carousel__nav--prev");
  var next = root.querySelector(".carousel__nav--next");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var current = 0;
  var timer = null;

  var dots = Array.prototype.map.call(slides, function (_, index) {
    var dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", "Diapositiva " + (index + 1));
    dot.addEventListener("click", function () {
      go(index);
      restart();
    });
    dotsBox.appendChild(dot);
    return dot;
  });

  function go(index) {
    slides[current].classList.remove("is-active");
    current = (index + slides.length) % slides.length;
    slides[current].classList.add("is-active");
    dots.forEach(function (dot, i) {
      dot.setAttribute("aria-selected", i === current ? "true" : "false");
    });
  }

  function start() {
    if (reduceMotion || slides.length < 2) {
      return;
    }
    timer = window.setInterval(function () {
      go(current + 1);
    }, INTERVAL_MS);
  }

  function stop() {
    window.clearInterval(timer);
    timer = null;
  }

  function restart() {
    stop();
    start();
  }

  prev.addEventListener("click", function () {
    go(current - 1);
    restart();
  });
  next.addEventListener("click", function () {
    go(current + 1);
    restart();
  });
  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stop();
    } else {
      restart();
    }
  });

  var touchX = null;
  root.addEventListener("touchstart", function (event) {
    touchX = event.touches[0].clientX;
  }, { passive: true });
  root.addEventListener("touchend", function (event) {
    if (touchX === null) {
      return;
    }
    var delta = event.changedTouches[0].clientX - touchX;
    if (Math.abs(delta) > 40) {
      go(current + (delta < 0 ? 1 : -1));
      restart();
    }
    touchX = null;
  });

  go(0);
  start();
})();
