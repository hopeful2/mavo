(function($, $$) {

var _ = Mavo.Expressions = $.Class({
	constructor: function(mavo) {
		this.mavo = mavo;
		this.active = true;

		this.expressions = [];

		var syntax = Mavo.Expression.Syntax.create(this.mavo.element.closest("[mv-expressions]")) || Mavo.Expression.Syntax.default;
		this.traverse(this.mavo.element, undefined, syntax);

		this.scheduled = new Set();

		this.mavo.treeBuilt.then(() => {
			this.expressions = [];

			// Watch changes and update value
			document.documentElement.addEventListener("mavo:datachange", evt => {
				if (!this.active) {
					return;
				}

				if (evt.action == "propertychange" && evt.node.closestCollection) {
					// Throttle propertychange events in collections and events from other Mavos
					if (!this.scheduled.has(evt.property)) {
						setTimeout(() => {
							this.scheduled.delete(evt.property);
							this.update(evt);
						}, _.PROPERTYCHANGE_THROTTLE);

						this.scheduled.add(evt.property);
					}
				}
				else {
					requestAnimationFrame(() => this.update(evt));
				}
			});

			this.update();
		});
	},

	update: function(evt) {
		var root, rootGroup;

		if (evt instanceof Element) {
			root = evt.closest(Mavo.selectors.group);
			evt = null;
		}

		root = root || this.mavo.element;
		rootGroup = Mavo.Node.get(root);

		var data = rootGroup.getData({live: true});

		rootGroup.walk((obj, path) => {
			if (obj.expressions && obj.expressions.length && !obj.isDeleted()) {
				let env = { context: this, data: $.value(data, ...path) };

				Mavo.hooks.run("expressions-update-start", env);
				for (let et of obj.expressions) {
					if (et.changedBy(evt)) {
						et.update(env.data, evt);
					}
				}
			}
		});
	},

	extract: function(node, attribute, path, syntax) {
		if (attribute && attribute.name == "mv-expressions") {
			return;
		}

		if ((attribute && _.directives.indexOf(attribute.name) > -1) ||
		    syntax.test(attribute? attribute.value : node.textContent)
		) {
			this.expressions.push(new Mavo.DOMExpression({
				node, syntax,
				path: path? path.slice(1).split("/").map(i => +i) : [],
				attribute: attribute && attribute.name,
				mavo: this.mavo
			}));
		}
	},

	// Traverse an element, including attribute nodes, text nodes and all descendants
	traverse: function(node, path = "", syntax) {
		if (node.nodeType === 8) {
			// We don't want expressions to be picked up from comments!
			// Commenting stuff out is a common debugging technique
			return;
		}

		if (node.nodeType === 3) { // Text node
			// Leaf node, extract references from content
			this.extract(node, null, path, syntax);
		}
		else {
			node.normalize();

			syntax = Mavo.Expression.Syntax.create(node) || syntax;

			if (syntax === Mavo.Expression.Syntax.ESCAPE) {
				return;
			}

			if (Mavo.is("multiple", node)) {
				path = "";
			}

			$$(node.attributes).forEach(attribute => this.extract(node, attribute, path, syntax));
			$$(node.childNodes).forEach((child, i) => this.traverse(child, `${path}/${i}`, syntax));
		}
	},

	static: {
		directives: [],

		PROPERTYCHANGE_THROTTLE: 50,

		directive: function(name, o) {
			_.directives.push(name);
			Mavo.attributes.push(name);
			o.name = name;
			Mavo.Plugins.register(o);
		}
	}
});

if (self.Proxy) {
	Mavo.hooks.add("node-getdata-end", function(env) {
		if (env.options.live && (env.data && (typeof env.data === "object" || this.collection))) {
			var data = env.data;

			if (typeof env.data !== "object") {
				env.data = {
					[Symbol.toPrimitive]: () => data,
					[this.property]: data
				};
			}

			env.data = new Proxy(env.data, {
				get: (data, property, proxy) => {
					// Checking if property is in proxy might add it to the data
					if (property in data || (property in proxy && property in data)) {
						return data[property];
					}
				},

				has: (data, property) => {
					if (property in data) {
						return true;
					}

					// Property does not exist, look for it elsewhere

					switch(property) {
						case "$index":
							data[property] = this.index || 0;
							return true; // if index is 0 it's falsy and has would return false!
						case "$all":
							return data[property] = this.closestCollection? this.closestCollection.getData(env.options) : [env.data];
						case "$next":
						case "$previous":
							if (this.closestCollection) {
								return data[property] = this.closestCollection.getData(env.options)[this.index + (property == "$next"? 1 : -1)];
							}

							data[property] = null;
							return null;
						case "$edit":
							data[property] = this.editing;
							return true;
					}

					if (this instanceof Mavo.Group && property == this.property && this.collection) {
						return data[property] = env.data;
					}

					// First look in ancestors
					var ret = this.walkUp(group => {
						if (property in group.children) {
							return group.children[property];
						};
					});

					if (ret === undefined) {
						// Still not found, look in descendants
						ret = this.find(property);
					}

					if (ret !== undefined) {
						if (Array.isArray(ret)) {
							ret = ret.map(item => item.getData(env.options))
									 .filter(item => item !== null);
						}
						else if (ret instanceof Mavo.Node) {
							ret = ret.getData(env.options);
						}

						data[property] = ret;

						return true;
					}

					// Does it reference another Mavo?
					if (property in Mavo.all && Mavo.all[property].root) {
						return data[property] = Mavo.all[property].root.getData(env.options);
					}

					return false;
				},

				set: function(data, property, value) {
					throw Error("You can’t set data via expressions.");
				}
			});
		}
	});
}

})(Bliss, Bliss.$);
