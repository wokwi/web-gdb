# web-gdb-multiarch

gdb-multiarch running in a web-browser!

## How can I use it?

To use web-gdb-multiarch on Wokwi, open any project (e.g. this [Simon game](https://wokwi.com/arduino/libraries/demo/simon-game)),
click on the code editor, and press F1. In the prompt that opens, type "GDB":

![](https://blog.wokwi.com/content/images/2021/02/image-8.png)

Choose the "debug build" option (the release build is harder to debug, but it's useful if your program uses the FastLED library).
Web GDB will load in a new browser tab (you have to be a bit patient), and you should get the familiar GDB prompt:

```
0x00000000 in __vectors ()
(gdb)
```

At this point, you can write `continue` to start the program, or better - check out the
[Arduino/AVR GDB Cheatsheet](https://blog.wokwi.com/gdb-avr-arduino-cheatsheet/) to see all the things GDB can do for you!

## How does it work?

Great question, you'll find the answer in my [Running GDB in the Browser](https://blog.wokwi.com/running-gdb-in-the-browser) blog post.
