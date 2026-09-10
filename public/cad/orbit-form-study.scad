// ORBIT — editable industrial design envelope, millimetres.
// 48 x 12 mm is provisional. NOT a verified board fit or fabrication release.
// Uniform circular slice. Front glass, side talk button and mute toggle.
$fn=160;
diameter=48;
depth=12;
wall=1.6;
edge=0.7;
screen_diameter=41;
module rounded_disc(d,h,r){rotate_extrude() polygon([[0,-h/2],[d/2-r,-h/2],[d/2,-h/2+r],[d/2,h/2-r],[d/2-r,h/2],[0,h/2]]);}
module shell(){difference(){rounded_disc(diameter,depth,edge);cylinder(d=diameter-2*wall,h=depth-2*wall,center=true);translate([0,0,depth/2])cylinder(d=screen_diameter,h=wall*3,center=true);translate([0,-diameter/2,0])cube([9,5,3.4],center=true);translate([diameter/2,4.5,0])rotate([0,90,0])cylinder(d=4.5,h=5,center=true);translate([diameter/2,-4.8,0])cube([5,7,2.8],center=true);}}
color("ivory")shell();
color([.145,.153,.20])translate([0,0,depth/2-.2])cylinder(d=screen_diameter-.25,h=.5,center=true);
color([.52,.52,.95])translate([diameter/2,4.5,0])rotate([0,90,0])cylinder(d=4.2,h=1.7,center=true);
color([.95,.54,.28])translate([diameter/2+.3,-3.4,0])cube([1.4,2.7,2],center=true);
