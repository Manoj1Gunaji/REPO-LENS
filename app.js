const express=require("express");
const app=express();
const path=require("path");
const ejsMate=require("ejs-mate");
const ExpressError=require("./utils/ExpressError.js");
app.set("views",path.join(__dirname,"views"));
app.set("view engine","ejs");
const methodOverride=require("method-override");
app.use(express.urlencoded({extended:true}));
app.use(methodOverride("_method")); 
app.use(express.static(path.join(__dirname,"public")));
app.engine("ejs",ejsMate);
const session=require("express-session");






app.listen("8080",()=>{
    console.log("app is listening to the port");
})