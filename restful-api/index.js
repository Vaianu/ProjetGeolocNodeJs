const express = require('express');
var session = require('cookie-session');
const bodyParser = require('body-parser');
const app = express();
const mysql = require('mysql');
 
// parse application/json
app.use(bodyParser.json());

app.use(session({secret: 'apigeo'}));

// Lecture du fichier config.json
const fs = require('fs');
var fichier = fs.readFileSync(__dirname + '/config.json');
var config = JSON.parse(fichier);

//créer une connexion à la base de données
const conn = mysql.createConnection({
  host: config['host'],
  user: config['user'],
  password: config['password'],
  database: config['database']
});
 
//connexion à la base de données
conn.connect(function(err) {
  if(err) throw err;
  console.log('Mysql Connected...');
});


//pour indiquer le chemin des templates et indiquer qu'on utilise ejs comme système de template
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');



/**
 * Envoie tous les salles au format JSON
 * Sera appelé par retrofitInstance de l'application android
 */
app.get('/apigeo/geolocalisation/salle',function(req, res) {
  var sql = "SELECT id, nom FROM salle";
  conn.query(sql, function(err, results) {
    if(err) throw err;
    res.send(JSON.stringify({"salles_results": results})); //envoie des salles au format JSON
  });
});

/**
 * réception du choix de la salle(noeud salle) choisit par l'utilisateur,
 * recherche du chemin et affiche le plan avec l'itinéraire menant à la salle
 * Sera appelé par la Webview de l'application android pour fournir le plan
 * avec l'itinéraire menant à la salle
 * @param choixSalle la salle choisit par l'utilisateur
 */ 
app.get('/apigeo/geolocalisation/salle/:choixSalle',function(req, res) {
	var sql = "SELECT id FROM salle";
  	conn.query(sql, function(err, results) {
    	if(err) throw err;
		var tabNoeudsSalles = new Array();
		for(var i=0; i<results.length; i++)
			tabNoeudsSalles.push(results[i].id); //on récupére dans un tableau les id des salles pour vérif
		
		var choixSalle = parseInt(req.params.choixSalle, 10);
		if(tabNoeudsSalles.indexOf(choixSalle) != -1) { //on vérifie que le choix salle donné correspond bien à une salle
			req.session.tabNoeudsChemin = [];
			rechercherChemin(choixSalle, function(err, chemin) {
				if(err) {
					console.error(err);
				}
				else {
					req.session.tabNoeudsChemin = chemin; // réceptionne tableau noeuds menant à la salle et le stocke dans variable de session
					var direction = "Dirigez-vous au premier point de passage en face";
					var position = 1;
					res.render('plan.ejs', {tabNoeudsChemin: req.session.tabNoeudsChemin, direction: direction, position: position, couleur_itineraire: config['couleur_itineraire']});
				}
			});
		}
		else { //sinon on renvoie un code erreur 404 indiquant que la salle n'existe pas
			res.setHeader('Content-Type', 'text/plain');
			res.status(404).send('Erreur: Salle introuvable');
		}
  	});
});

/**
 * réceptionne le tag Qrcode scanné par l'utilisateur
 * Sera appelé par la Webview de l'application android pour mettre à jour le plan (position de l'utilisateur sur le plan)
 * @param pointPassageActuel le point passage actuel où est l'utilisateur (tag QrCode qu'il a scanné)
 */ 
app.get('/apigeo/geolocalisation/position/:pointPassageActuel',function(req, res) {
	var tabNoeudsChemin = req.session.tabNoeudsChemin; // variable de session (représente le chemin menant à la salle choisie par l'utilisateur)
	if(tabNoeudsChemin != undefined) { // si une salle a été choisie = tabNoeudsChemin pas vide, doit appeler d'abord la route précédente pour choisir une salle
		var sql = "SELECT count(*) nombre_noeuds FROM noeud";
  		conn.query(sql, function(err, results) {
			if(err) throw err;
		
			var positionActuelle = parseInt(req.params.pointPassageActuel, 10);
			var nombre_noeuds = results[0].nombre_noeuds; // récupère le nombre total de noeuds
			if(positionActuelle > 0 && positionActuelle <= nombre_noeuds) { // si qrcode scanné par l'utilisateur est connu du système 
				var direction = null;

				if(tabNoeudsChemin.indexOf(positionActuelle) != -1) { // si qrcode scanné figure bien dans le tableau du chemin menant à la salle
					if(positionActuelle == tabNoeudsChemin[tabNoeudsChemin.length-1]) { // si arrivé
						direction = "Vous êtes arrivé";
						res.render('plan.ejs', {tabNoeudsChemin: req.session.tabNoeudsChemin, direction: direction, position: positionActuelle, couleur_itineraire: config['couleur_itineraire']});
					}
					else { // si pas arrivé
						var pointPassageSuivant = tabNoeudsChemin[tabNoeudsChemin.indexOf(positionActuelle)+1]; // récupère le point passage suivant en fonction du qrcode scanné 
																													//pour indiquer la direction à suivre
						var sql = "SELECT direction FROM qrcode WHERE noeud="+positionActuelle+" AND noeud_fils="+pointPassageSuivant;
						conn.query(sql, function(err, results) {
    						if(err) throw err;
							direction = results[0].direction;
							res.render('plan.ejs', {tabNoeudsChemin: req.session.tabNoeudsChemin, direction: direction, position: positionActuelle, couleur_itineraire: config['couleur_itineraire']});
						});
					}
				}
				else { // si qrcode scanné ne figure pas dans le tableau du chemin menant à la salle
					direction = "Veuillez revenir au point passage précédent";
					res.render('plan.ejs', {tabNoeudsChemin: req.session.tabNoeudsChemin, direction: direction, position: positionActuelle, couleur_itineraire: config['couleur_itineraire']});
				}
			}
			else { //sinon on renvoie un code erreur 404 indiquant que le qrcode scanné est inconnu
				res.writeHead(404);
				res.end('Erreur: Qrcode inconnu');
			}
  		});
	}
	else { // si pas de salle choisie
		res.setHeader('Content-Type', 'text/plain');
		res.status(404).send('Erreur: salle non choisie');
	}
});



//gére les erreurs 404

app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/plain');
    res.status(404).send('Page introuvable !');
});
 
//écoute du serveur 
app.listen(3000,function() {
  console.log('Server started on port 3000...');
});






const AUCUN = -1;
var NB_NOEUDS = null;
	
const WHITE = 111;
const GREY = 222;
const BLACK = 333;

var couleur = null;
var parent = null;
var chemin = null;

function rechercherChemin(dest, callback) {
	var sql = "SELECT count(*)+1 nombre_noeuds FROM noeud"; // count()+1 car indice tableau commence à 0, pour lesNoeuds.length
  	var query = conn.query(sql, function(err, results) {								// comme ça noeud 1 correspondra à lesNoeuds[1] exemple
	   	if(err) throw err;
		NB_NOEUDS = results[0].nombre_noeuds;
		couleur = new Array(NB_NOEUDS);
		parent = new Array(NB_NOEUDS);
		chemin = new Array();
		bfs(1, dest, callback);
  	});
}

function bfs(s, d, callback) {
		const src = s;
		const dest = d;
		const lesNoeuds = new Array(NB_NOEUDS);
		for(var i=0; i<lesNoeuds.length; i++)
		{
			lesNoeuds[i] = new Array();
		}
		
		var sql = "SELECT noeud, noeud_fils FROM qrcode WHERE disponible=1";
  		var query = conn.query(sql, function(err, results) {
  	  		if(err) throw err;
			for(var i=0; i<results.length; i++)
			{
				lesNoeuds[results[i].noeud].push(results[i].noeud_fils);
			}
		
			for(var i=0; i<NB_NOEUDS; i++)
			{
				couleur[i] = WHITE;
				parent[i] = AUCUN;
			}
		
			couleur[src] = GREY;
			parent[src] = AUCUN;
		
			const fileAttente = new Array();
			fileAttente.push(src);
		
			while(fileAttente.length > 0)
			{
				var u = fileAttente.pop();
				for(var i=0; i<lesNoeuds[u].length; i++)
				{
					var a = lesNoeuds[u][i];
					if(couleur[a] == WHITE)
					{
						couleur[a] = GREY;
						parent[a] = u;
						fileAttente.push(lesNoeuds[u][i]);
					}
				}
				couleur[u] = BLACK;
			}
			print_path(src, dest);
			callback(null, chemin);
  		});
}

function print_path(src, dest) {
		
		if(src == dest)
		{
			chemin.push(dest);
		}
		else if(parent[dest] == AUCUN)
		{
			//System.out.println("IL n'y a pas de chemin de " + src + " vers " + dest);
		}
		else
		{			
			print_path(src, parent[dest]);
			chemin.push(dest);
		}
}












